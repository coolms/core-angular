import { Injectable, inject } from '@angular/core';
import { Location } from '@angular/common';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { catchError, firstValueFrom, map, of, ReplaySubject, tap } from 'rxjs';
import { Logout, RestoreSession } from '../auth/auth.actions';
import { AuthState } from '../auth/auth.state';
import { BYPASS_AUTH } from '../auth/auth.interceptor';
import { AuthRefreshCoordinator } from '../auth/auth-refresh.coordinator';
import { CrossTabAuthSyncService } from '../auth/cross-tab-auth-sync.service';
import { SetAppConfig } from '../state/app-config.state';
import { type ThemeConfigResponse } from '../api/api-manifest.types';
import { UserPreferencesService } from '../services/user-preferences.service';

@Injectable({ providedIn: 'root' })
export class AppInitService {
    // Injected as values, not constructor parameters: an injection token has to
    // exist at runtime, and a type-only import of one type-checks clean while
    // the Angular compiler rejects it with NG2003.
    private readonly http               = inject(HttpClient);
    private readonly store              = inject(Store);
    private readonly router             = inject(Router);
    private readonly location           = inject(Location);
    private readonly prefs              = inject(UserPreferencesService);
    private readonly crossTabSync       = inject(CrossTabAuthSyncService);
    private readonly refreshCoordinator = inject(AuthRefreshCoordinator);

    /** The only hardcoded URL — everything else comes from the manifest. */
    private readonly configUrl = '/api/v1/theme/config';

    /**
     * Emits (once) when load() has fully completed — tokens settled, manifest
     * set (or swallowed on error).  authGuard subscribes to this so it never
     * evaluates isAuthenticated against a partially-restored stale token.
     */
    private readonly initComplete = new ReplaySubject<void>(1);
    readonly ready$ = this.initComplete.asObservable();

    async load(): Promise<void> {
        // ── Step 0: cross-tab sync ────────────────────────────────────────────
        //
        // Install the storage-event listener before RestoreSession so that
        // any localStorage mutation from a sibling tab during bootstrap
        // (e.g., a parallel tab refreshing tokens just as we load) is mirrored
        // into this tab's NGXS state.
        this.crossTabSync.start();

        // ── Step 1: restore tokens from localStorage ──────────────────────────
        //
        // RestoreSession is synchronous (ctx.setState from localStorage), so
        // this await resolves in the same microtask.  Tokens are in NGXS state
        // before ANY subsequent HTTP request fires — the auth interceptor reads
        // the token from state when attaching Authorization headers, so this
        // ordering prevents unauthenticated requests on page reload (F5).
        await firstValueFrom(this.store.dispatch(new RestoreSession()));

        // ── Step 2: fetch the manifest ────────────────────────────────────────
        //
        // BYPASS_AUTH is required here — not optional.  The manifest endpoint
        // is public, but two specific failure modes make bypassing necessary:
        //
        //   a) The stored access token may be expired.  Without BYPASS_AUTH the
        //      interceptor attaches the expired token, gets a 401, and tries to
        //      refresh.  But the refresh endpoint URL comes from the manifest
        //      (api.refresh() reads manifest.auth.refresh), which hasn't been
        //      loaded yet — triggering a null-dereference crash before the app
        //      can recover.
        //
        //   b) Even if the token is valid, attaching it to a public endpoint
        //      that ignores auth adds unnecessary coupling.
        //
        // Consequence: every page load issues one unauthenticated config
        // request, which is intentional.  All subsequent API calls carry the
        // restored (or refreshed) token normally.
        const config = await firstValueFrom(
            this.http.get<ThemeConfigResponse>(this.configUrl, {
                context: new HttpContext().set(BYPASS_AUTH, true),
            }).pipe(
                tap(cfg => this.store.dispatch(new SetAppConfig(cfg))),
                catchError(() => {
                    console.warn('CoolMS: theme/config unreachable, using safe defaults');
                    return of(null);
                }),
            ),
        );

        // ── Step 3: validate the restored session ─────────────────────────────
        //
        // RestoreSession trusts whatever tokens are in localStorage, but they may
        // have been revoked out-of-band — most notably, signing out on the public
        // SSR site revokes the user's WHOLE token set. We MUST settle the real
        // auth state here, BEFORE step 4 signals ready$: both the auth interceptor
        // AND authGuard gate on ready$, so if we signalled first, the guard would
        // race ahead and mount the shell against the stale isAuthenticated=true
        // before this probe finished (→ half-loaded shell + "Session expired"
        // toasts, the exact bug this fixes). Because the probe itself cannot wait
        // on ready$ (that would deadlock), validateSession() bypasses the
        // interceptor and attaches the token / drives the refresh by hand.
        const meUrl = config?.manifest.identity?.meUrl;
        if (meUrl && this.store.selectSnapshot(AuthState.isAuthenticated)) {
            await this.validateSession(meUrl);
        }

        // ── Step 4: signal authGuard + unblock the interceptor ────────────────
        //
        // Auth state is now settled (session confirmed, refreshed, or Logout
        // dispatched). ReplaySubject(1) replays to guards/requests that subscribe
        // afterwards, so they evaluate against the final isAuthenticated value.
        this.initComplete.next();
        this.initComplete.complete();

        // ── Step 5: navigate to last-visited route ────────────────────────────
        //
        // Only when the session survived validation. If it did not, isAuthenticated
        // is now false, we skip the saved-route navigation, and authGuard sends the
        // initial navigation to /login.
        //
        // Only restore when the user opened the bare /admin root. An explicit
        // deep link (pasted /admin/sync-fleet, a bookmark, a shared URL) must
        // win over the saved route. The router cannot tell us which one this is:
        // withEnabledBlockingInitialNavigation holds the initial navigation until
        // this initializer resolves, so router.url is still '/'. The browser
        // location is the only record of what was requested — Location.path()
        // reads it with the /admin base href stripped, so the bare root (with or
        // without trailing slash) yields ''. Anything else, including a root URL
        // carrying query params, is treated as an explicit destination.
        if (this.store.selectSnapshot(AuthState.isAuthenticated)) {
            const requested = this.location.path();
            if (requested === '' || requested === '/') {
                const saved = this.prefs.getPageState<{ lastRoute?: string }>('nav');
                if (saved?.lastRoute && !saved.lastRoute.startsWith('/login')) {
                    void this.router.navigateByUrl(saved.lastRoute);
                }
            }
        }
    }

    /**
     * Confirm the restored session is still alive, settling AuthState before the
     * app unblocks. Runs OUTSIDE the auth interceptor (BYPASS_AUTH) because the
     * interceptor queues behind ready$, which has not fired yet at this point.
     *
     *   • access token accepted  → done, session alive;
     *   • access token rejected  → attempt ONE refresh (access tokens are short-lived,
     *                              so an expired one with a valid refresh token must
     *                              stay logged in). The coordinator dispatches Logout
     *                              on a refresh 401 and SetTokens on success; a
     *                              transient failure (5xx/network) is swallowed so a
     *                              momentary blip never kills a valid session.
     */
    private async validateSession(meUrl: string): Promise<void> {
        const token = this.store.selectSnapshot(AuthState.accessToken);
        if (await this.probe(meUrl, token)) {
            return;
        }
        const refreshToken = this.store.selectSnapshot(AuthState.refreshToken);
        if (!refreshToken) {
            this.store.dispatch(new Logout());
            return;
        }
        let refreshedToken: string | null = null;
        try {
            refreshedToken = await firstValueFrom(this.refreshCoordinator.refresh(refreshToken));
        } catch {
            // 401 → coordinator already dispatched Logout; transient → session kept.
            return;
        }
        // Refresh resolved — but the coordinator's fresh-state optimisation can hand
        // back the SAME access token (without a network round-trip) when its stored
        // expiry still looks fresh. For a token that was revoked but not yet expired
        // (signing out on the SSR site while the access token is still in its TTL),
        // that token is dead despite looking fresh. Re-probe with whatever we now
        // hold; a second rejection means the session is genuinely gone.
        if (!(await this.probe(meUrl, refreshedToken))) {
            this.store.dispatch(new Logout());
        }
    }

    /** GET an authed endpoint with an explicit Bearer header, bypassing the interceptor. */
    private probe(url: string, token: string | null): Promise<boolean> {
        return firstValueFrom(
            this.http.get(url, {
                context: new HttpContext().set(BYPASS_AUTH, true),
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            }).pipe(
                map(() => true),
                catchError(() => of(false)),
            ),
        );
    }
}

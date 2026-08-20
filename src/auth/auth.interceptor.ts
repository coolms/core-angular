import { inject } from '@angular/core';
import {
    HttpContextToken, type HttpInterceptorFn,
    HttpErrorResponse,
} from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Router } from '@angular/router';
import { AuthState } from './auth.state';
import { Logout } from './auth.actions';
import { AuthRefreshCoordinator } from './auth-refresh.coordinator';
import { AppInitService } from '../bootstrap/app-init.service';
import { catchError, switchMap, take, throwError } from 'rxjs';

// ── Opt-out context token ─────────────────────────────────────────────────────
//
// Set BYPASS_AUTH to true on any HttpRequest to skip adding the Authorization
// header entirely.  Used by AppInitService for the bootstrap config request so
// that a stale localStorage token does not cause a 401 on a public endpoint.

export const BYPASS_AUTH = new HttpContextToken<boolean>(() => false);

// ─────────────────────────────────────────────────────────────────────────────

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const store       = inject(Store);
    const router      = inject(Router);
    const coordinator = inject(AuthRefreshCoordinator);
    const initService = inject(AppInitService);

    // Caller explicitly requested no auth header (e.g. the bootstrap config
    // fetch — the endpoint is public and a stale token would cause 401).
    if (req.context.get(BYPASS_AUTH)) {
        return next(req);
    }

    // Auth endpoints are public by design.  The backend's JWT firewall rejects any
    // request that carries an invalid/expired Bearer token — even on endpoints
    // that would otherwise allow anonymous access — so never forward a stored
    // token to login or refresh.
    if (req.url.includes('/auth/login') || req.url.includes('/auth/refresh')) {
        return next(req);
    }

    // Queue behind AppInitService.ready$ so that token restoration from
    // localStorage (RestoreSession) is guaranteed to be in NGXS state before
    // we read it.  On F5 the interceptor fires synchronously for every pending
    // request before APP_INITIALIZER has completed; without this guard the
    // token snapshot is null and every request gets a 401 → refresh cycle even
    // for a perfectly valid session.
    //
    // ready$ is a ReplaySubject(1) that completes after load() finishes, so:
    //   • requests fired during init queue here and flush the moment ready$ emits;
    //   • requests fired after init pass through take(1) immediately (replayed value).
    return initService.ready$.pipe(
        take(1),
        switchMap(() => {
            const token  = store.selectSnapshot(AuthState.accessToken);
            const authed = token
                ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
                : req;

            return next(authed).pipe(
                catchError((err: unknown) => {
                    if (!(err instanceof HttpErrorResponse) || err.status !== 401) {
                        return throwError(() => err);
                    }

                    // Avoid infinite loop — skip refresh for auth endpoints themselves.
                    if (req.url.includes('/auth/refresh') || req.url.includes('/auth/login')) {
                        return throwError(() => err);
                    }

                    const refreshToken = store.selectSnapshot(AuthState.refreshToken);
                    if (!refreshToken) {
                        store.dispatch(new Logout());
                        // Only navigate programmatically once the router has already
                        // completed its initial navigation.  During APP_INITIALIZER the
                        // router is still blocked; authGuard handles the redirect there.
                        if (router.navigated) void router.navigate(['/login']);
                        return throwError(() => err);
                    }

                    // Delegate refresh to the shared coordinator so the
                    // Centrifuge getToken path and the interceptor share ONE
                    // in-flight refresh. Without this, two parallel
                    // `api.refresh(refreshToken)` calls (one from each mutex)
                    // would send the same refresh-token twice and trigger the
                    // backend's `isUsed` replay branch on the second arrival,
                    // wiping the whole session.
                    return coordinator.refresh(refreshToken).pipe(
                        switchMap(newToken =>
                            next(req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } })),
                        ),
                    );
                }),
            );
        }),
    );
};

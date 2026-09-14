import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpContext, HttpContextToken } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { defer, finalize, type Observable, of, shareReplay, Subject, switchMap, tap } from 'rxjs';
import { AppConfigState } from '../state/app-config.state';
import { ELEVATION_PROMPT, type ElevationPromptRequest } from './elevation-prompt.port';
import type {
    ElevationChange, ElevationChangeKind, ElevationDropReason, ElevationState,
} from './elevation.types';

/**
 * Set on a request that must never open the elevation prompt: the elevation
 * endpoint's own calls (a wrong password is a 403 and is not a refused action),
 * and any caller that would rather receive its 403 and decide for itself.
 */
export const BYPASS_ELEVATION = new HttpContextToken<boolean>(() => false);

/**
 * The `storage` key whose write announces "this session's elevation changed"
 * to the other tabs of the same browser. One token chain is shared across
 * tabs (ADR-184 s.5, s.7), so a grant or a drop in one tab is true in all of
 * them; the others learn of it here rather than at their next 403.
 */
const CROSS_TAB_KEY = 'coolms.elevation.changed';

/**
 * The elevation state of this session, read from ONE place: the server.
 *
 * ADR-184's client requirement, in one service. The state endpoint is the only
 * source -- `elevated`, `expiresAt`, how the last elevation ended -- and every
 * change of it is announced on `changes$` so the Explorer listing can refetch
 * (its capability flags are the server's reading of the same state, computed
 * when the listing was fetched, and a `write: true` fetched while elevated
 * must not outlive the elevation). Three things move the state: a grant, a
 * drop, and the expiry timer, which asks the server again at `expiresAt`
 * rather than flipping a local flag -- the client keeps no decider of its own.
 *
 * The prompt is not here: dialogs are the kit's, a layer above core. The
 * service asks the `ELEVATION_PROMPT` port and shares ONE in-flight prompt, so
 * a burst of refused requests (a multi-select delete is one 403 per node)
 * opens one dialog and every caller waits on the same answer.
 */
@Injectable({ providedIn: 'root' })
export class ElevationService {
    private readonly http       = inject(HttpClient);
    private readonly store      = inject(Store);
    private readonly prompt     = inject(ELEVATION_PROMPT, { optional: true });
    private readonly destroyRef = inject(DestroyRef);

    /** The last state the server reported; null until the first read. */
    readonly state = signal<ElevationState | null>(null);

    /** Convenience over `state`: false until the server has said otherwise. */
    readonly elevated = computed(() => this.state()?.elevated ?? false);

    /** `expiresAt` as a Date, null when not elevated. */
    readonly expiresAt = computed<Date | null>(() => {
        const iso = this.state()?.expiresAt;
        return iso ? new Date(iso) : null;
    });

    /**
     * Every change of elevation state: a grant, a drop (by this person, by the
     * beacon, by the tripwire), an expiry, or an observed change of a live
     * grant's `expiresAt`. A refresh that reports the same state emits nothing,
     * so subscribers that refetch a listing on it never refetch for no reason.
     */
    readonly changes$ = new Subject<ElevationChange>();

    private expiryTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingPrompt: Observable<boolean> | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('storage', this.onStorage);
            this.destroyRef.onDestroy(() => {
                window.removeEventListener('storage', this.onStorage);
                this.clearTimer();
            });
        }
    }

    /** The manifest carries the URL; without it the service is inert, not broken. */
    get available(): boolean {
        return this.url !== null;
    }

    private get url(): string | null {
        return this.store.selectSnapshot(AppConfigState.manifest)?.identity?.elevationUrl ?? null;
    }

    /**
     * Whether a URL is one the elevation gate stands in front of. The
     * requirement names the VFS: every write-ish action under `{apiBase}/vfs/`
     * is refused with 403 by the same decider that computed the listing's
     * flags. Other gated surfaces (the media listing scope, the terminal) are
     * not matched here until their refusals are specified the same way.
     */
    isGated(url: string): boolean {
        const apiBase = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
        return url.includes(`${apiBase}/vfs/`);
    }

    /** Ask the server. Applies the answer and announces it when it differs. */
    refresh(): Observable<ElevationState> {
        const url = this.url;
        if (!url) return of(this.inert());

        return this.http.get<ElevationState>(url, this.options()).pipe(
            tap(s => this.apply(s)),
        );
    }

    /**
     * Elevate with the admin password and, when the switch is on, a code from
     * the admin authenticator. Errors are the dialog's to branch on: 403 wrong
     * password or wrong / replayed code, 428 a code is required, 409 the
     * installation cannot elevate yet, 429 throttled. They pass through
     * untouched, and never open the prompt (BYPASS_ELEVATION).
     */
    elevate(password: string, code?: string): Observable<ElevationState> {
        const url = this.url;
        if (!url) return of(this.inert());

        const body: { password: string; code?: string } = { password };
        if (code) body.code = code;

        return this.http.post<ElevationState>(url, body, this.options()).pipe(
            tap(s => this.apply(s, 'granted')),
        );
    }

    /** Drop the elevation now. Idempotent on the server: nothing live is still a 204. */
    drop(reason: ElevationDropReason = 'dropped_by_user'): Observable<ElevationState> {
        const url = this.url;
        if (!url) return of(this.inert());

        return this.http.delete<void>(`${url}?reason=${reason}`, this.options()).pipe(
            switchMap(() => this.refresh()),
        );
    }

    /**
     * What the interceptor calls on a 403: ask the server whether this session
     * is elevated, and only when it is not, offer the prompt. A 403 while
     * elevated is a real refusal -- elevation would not change it -- and is
     * handed back as such (false, no prompt).
     */
    offerFor(refusal?: string): Observable<boolean> {
        if (!this.available || !this.prompt) return of(false);

        return this.refresh().pipe(
            switchMap(state => state.elevated ? of(false) : this.requestElevation({ state, refusal })),
        );
    }

    /**
     * Open the prompt, or join the one already open. Resolves to whether the
     * session is elevated once the dialog closes.
     */
    requestElevation(request: ElevationPromptRequest): Observable<boolean> {
        if (!this.prompt) return of(false);
        if (this.pendingPrompt) return this.pendingPrompt;

        const prompt = this.prompt;
        this.pendingPrompt = defer(() => prompt.open(request)).pipe(
            finalize(() => { this.pendingPrompt = null; }),
            shareReplay(1),
        );

        return this.pendingPrompt;
    }

    // -- internals ------------------------------------------------------------

    private options(): { context: HttpContext } {
        return { context: new HttpContext().set(BYPASS_ELEVATION, true) };
    }

    private inert(): ElevationState {
        return {
            elevated: false,
            ended: { reason: 'never', at: null },
            lifetimeSeconds: 0,
            lifetimeCeilingSeconds: 0,
            mfaRequired: false,
            warnings: [],
        };
    }

    /**
     * Store the answer, schedule the expiry read, announce a change.
     *
     * `explicit` names the change when the caller knows it (a grant). For a
     * plain refresh the kind is derived from the two states: elevated -> not
     * is `expired` when the server says so and `dropped` otherwise (the person,
     * another tab, the beacon, the tripwire); not -> elevated is a grant seen
     * from another tab; a live grant whose `expiresAt` moved is `observed`.
     */
    private apply(next: ElevationState, explicit?: ElevationChangeKind): void {
        const prev = this.state();
        this.state.set(next);
        this.schedule(next);

        const kind = explicit ?? this.kindOf(prev, next);
        if (kind === null) return;

        this.changes$.next({ kind, state: next });
        this.announceToOtherTabs();
    }

    private kindOf(prev: ElevationState | null, next: ElevationState): ElevationChangeKind | null {
        const was = prev?.elevated ?? false;
        if (was && !next.elevated) return next.ended.reason === 'expired' ? 'expired' : 'dropped';
        if (!was && next.elevated) return 'granted';
        if (was && next.elevated && (prev?.expiresAt ?? null) !== (next.expiresAt ?? null)) return 'observed';
        return null;
    }

    /**
     * At `expiresAt`, ask the server -- do not flip a local flag. The lifetime
     * counts from the grant on the server's clock; a client that expired
     * itself would be a second decider, and one with its own clock. If the
     * server still says elevated at that moment (skew), ask again shortly.
     */
    private schedule(state: ElevationState): void {
        this.clearTimer();
        if (!state.elevated || !state.expiresAt) return;

        // Floor: never a tight loop on a stale answer. Ceiling: a browser
        // treats a delay past 2^31-1 ms as ZERO and fires at once; the code
        // ceiling is an hour, so only bad data gets there, and it re-schedules.
        const wanted = Date.parse(state.expiresAt) - Date.now() + 250;
        const ms = Math.min(Math.max(1_000, wanted), 2_147_483_647);
        this.expiryTimer = setTimeout(() => {
            this.expiryTimer = null;
            this.refresh().subscribe({
                // apply() has re-scheduled from the fresh answer. Only when the
                // server still says elevated PAST its own expiresAt (clock skew
                // between the two) is a short retry needed instead.
                next: s => {
                    if (s.elevated && s.expiresAt && Date.parse(s.expiresAt) <= Date.now()) this.scheduleRetry();
                },
                error: () => this.scheduleRetry(),
            });
        }, ms);
    }

    private scheduleRetry(): void {
        this.clearTimer();
        this.expiryTimer = setTimeout(() => {
            this.expiryTimer = null;
            this.refresh().subscribe({ error: () => undefined });
        }, 5_000);
    }

    private clearTimer(): void {
        if (this.expiryTimer !== null) {
            clearTimeout(this.expiryTimer);
            this.expiryTimer = null;
        }
    }

    private announceToOtherTabs(): void {
        try {
            localStorage.setItem(CROSS_TAB_KEY, String(Date.now()));
        } catch {
            // Private mode or storage denied: the other tabs learn at their next 403.
        }
    }

    private readonly onStorage = (event: StorageEvent): void => {
        if (event.key !== CROSS_TAB_KEY || !this.available) return;
        this.refresh().subscribe({ error: () => undefined });
    };
}

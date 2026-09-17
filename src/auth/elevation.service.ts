import { DestroyRef, inject, Injectable, signal, untracked } from '@angular/core';
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
 * tabs, so a grant or a drop in one tab is true in all of
 * them; the others learn of it here rather than at their next 403.
 */
const CROSS_TAB_KEY = 'coolms.elevation.changed';

/**
 * The shortest gap between two reconciling reads. `visibilitychange` and
 * `focus` both fire when a window is re-activated, so without this a single
 * alt-tab costs two identical GETs.
 */
const RECONCILE_MIN_INTERVAL_MS = 2_000;

/**
 * The elevation state of this session, read from ONE place: the server.
 *
 * The elevation client requirement, in one service. The state endpoint is the only
 * source -- `elevated`, `expiresAt`, how the last elevation ended -- and every
 * change of it is announced on `changes$` so the Explorer listing can refetch
 * (its capability flags are the server's reading of the same state, computed
 * when the listing was fetched, and a `write: true` fetched while elevated
 * must not outlive the elevation).
 *
 * **Expiry is driven by the READ, not by a timer.** An elevation ends because
 * time passed, and time is not an event; a client that waits to be told has
 * nothing to wait for when the machine was asleep at the moment. So `state()`
 * does the arithmetic every time it is asked, and an answer whose `expiresAt`
 * has gone by reports expired without a request. The timer below still fires
 * at `expiresAt` and the tab still re-asks when it comes back into view -- both
 * are how the SERVER's answer is refreshed, which is a different thing from
 * knowing this one has run out.
 *
 * This is not a second decider. The server said "elevated until T"; after T,
 * continuing to report `elevated: true` asserts something it never said.
 *
 * The prompt is not here: dialogs are the kit's, a layer above core. The
 * service asks the `ELEVATION_PROMPT` port and shares ONE in-flight prompt, so
 * a burst of refused requests (a multi-select delete is one 403 per node)
 * opens one dialog and every caller waits on the same answer.
 */
/**
 * The header a 403 refused for want of elevation carries, with the gate's name
 * as its value. The server stamps it where the gate refused; the interceptor
 * prompts on it and on nothing else. There is no list of gated URLs on this
 * side any more: the one that stood here lagged the server by every route
 * whose refusal came from the VFS permission service under another module's
 * path (media, document and word templates, content distribution).
 */
export const ELEVATION_REQUIRED_HEADER = 'X-Elevation-Required';

@Injectable({ providedIn: 'root' })
export class ElevationService {
    private readonly http       = inject(HttpClient);
    private readonly store      = inject(Store);
    private readonly prompt     = inject(ELEVATION_PROMPT, { optional: true });
    private readonly destroyRef = inject(DestroyRef);

    /** The last answer the server gave, exactly as it gave it. */
    private readonly served = signal<ElevationState | null>(null);

    /**
     * The state as it stands NOW; null until the first read from the server.
     *
     * Deliberately NOT a `computed`. A cached derivation is only recomputed
     * when one of its dependencies changes, and nothing changes when an
     * elevation simply runs out -- so it would keep answering `elevated: true`
     * past the moment the server itself named, for as long as the machine
     * happened to be asleep.
     *
     * Reading past `expiresAt` also demotes the STORED answer. The value
     * returned here is already correct without that write; the write is only
     * how cached readers (a `computed`, an OnPush template) find out.
     */
    readonly state = (): ElevationState | null => {
        const served = this.served();
        if (served === null || !isPast(served)) return served;

        const expired = expiredView(served);
        // untracked: this read can happen inside a computed or a template, and
        // a signal write is refused there. The demotion is not a state change
        // of its own -- it is the answer we already hold, read correctly.
        untracked(() => this.served.set(expired));
        this.announceExpiryLater();
        return expired;
    };

    /** Convenience over `state`: false until the server has said otherwise. */
    readonly elevated = (): boolean => this.state()?.elevated ?? false;

    /** `expiresAt` as a Date, null when not elevated. */
    readonly expiresAt = (): Date | null => {
        const iso = this.state()?.expiresAt;
        return iso ? new Date(iso) : null;
    };

    /**
     * Every change of elevation state: a grant, a drop (by this person, by the
     * beacon, by the tripwire), an expiry, or an observed change of a live
     * grant's `expiresAt`. A refresh that reports the same state emits nothing,
     * so subscribers that refetch a listing on it never refetch for no reason.
     */
    readonly changes$ = new Subject<ElevationChange>();

    private expiryTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingPrompt: Observable<boolean> | null = null;
    private expiryAnnouncePending = false;
    private lastReconcileAt = 0;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('storage', this.onStorage);
            window.addEventListener('focus', this.onFocus);
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', this.onVisibilityChange);
            }
            this.destroyRef.onDestroy(() => {
                window.removeEventListener('storage', this.onStorage);
                window.removeEventListener('focus', this.onFocus);
                if (typeof document !== 'undefined') {
                    document.removeEventListener('visibilitychange', this.onVisibilityChange);
                }
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
     * Whether a URL belongs to THIS API: a relative one under the manifest's
     * `apiBase`, or an absolute one on this origin under it. The interceptor
     * acts on a stamped refusal from here and from nowhere else -- a third
     * party answering 403 with a header of the same name is not an invitation
     * to elevate this session.
     */
    isThisApi(url: string): boolean {
        const apiBase = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '/api/v1';
        let path = url.split('?')[0];
        if (/^https?:\/\//.test(path)) {
            try {
                const parsed = new URL(path);
                if (typeof window !== 'undefined' && parsed.host !== window.location.host) return false;
                path = parsed.pathname;
            } catch {
                return false;
            }
        }
        return path === apiBase || path.startsWith(`${apiBase}/`);
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
     *
     * `prev` is read RAW rather than through `state()`: the demotion is not
     * wanted here (this answer supersedes the stored one either way), and a
     * read that demoted would queue an expiry announcement the server's own
     * answer is about to make.
     */
    private apply(next: ElevationState, explicit?: ElevationChangeKind): void {
        const prev = untracked(() => this.served());
        this.served.set(next);
        this.schedule(next);

        const kind = explicit ?? this.kindOf(prev, next);
        if (kind === null) return;

        // Something is being announced here, so a queued expiry would be a
        // second telling of the same news -- or, after a grant, stale news.
        // A NULL kind must not cancel it: that is the case where a read
        // already demoted the stored answer, leaving this one nothing to
        // compare against, and the queued announcement is the only one there
        // will be.
        this.expiryAnnouncePending = false;

        this.changes$.next({ kind, state: next });
        this.announceToOtherTabs();
    }

    private kindOf(prev: ElevationState | null, next: ElevationState): ElevationChangeKind | null {
        // Raw: a grant nothing had read yet is still a grant that ENDED, and
        // this answer is the first notice of it. When a read demoted it first,
        // `prev` already says so and this correctly finds no change.
        const was = prev?.elevated ?? false;
        if (was && !next.elevated) return next.ended.reason === 'expired' ? 'expired' : 'dropped';
        if (!was && next.elevated) return 'granted';
        if (was && next.elevated && (prev?.expiresAt ?? null) !== (next.expiresAt ?? null)) return 'observed';
        return null;
    }

    /**
     * Tell the listings that this session's elevation ran out, once, and NOT
     * from inside the read that noticed: a subscriber refetches on this, and a
     * refetch started in the middle of a change detection pass is a write
     * during a read. The microtask runs at the end of the current task, before
     * anything can paint.
     *
     * A server answer arriving first clears the flag, so the announcement is
     * made by whichever of the two got there first, never by both. Other tabs
     * are NOT told: each one reaches the same conclusion from the same
     * `expiresAt` on its own read, so the storage write would only buy a
     * thundering herd of GETs.
     */
    private announceExpiryLater(): void {
        if (this.expiryAnnouncePending) return;
        this.expiryAnnouncePending = true;

        queueMicrotask(() => {
            if (!this.expiryAnnouncePending) return;
            this.expiryAnnouncePending = false;

            const state = untracked(() => this.served());
            if (state !== null && !state.elevated) this.changes$.next({ kind: 'expired', state });
        });
    }

    /**
     * Ask the server again at `expiresAt` -- an OPTIMISATION, not the
     * mechanism. `state()` already reports an elapsed grant as expired without
     * being told, so a timer that a sleeping machine swallows, or that a
     * background tab throttles to once a minute, now costs freshness rather
     * than correctness. What it buys is the listing refetch happening at the
     * moment of expiry instead of at the next read.
     *
     * Do not flip a local flag here: the lifetime counts from the grant on the
     * server's clock, and if the server still says elevated at that moment
     * (skew), the honest thing is to ask again shortly.
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

    /**
     * One more attempt, then stop. Giving up is affordable now and was not
     * before: the state a failed read leaves behind is still read through the
     * arithmetic above, so an unreachable server cannot leave this tab
     * believing it is elevated. What is lost is only news from elsewhere -- a
     * grant or a drop in another session -- and that is what the tab picks up
     * when it next comes into view.
     */
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

    private readonly onFocus = (): void => this.reconcile();

    private readonly onVisibilityChange = (): void => {
        if (document.visibilityState === 'visible') this.reconcile();
    };

    /**
     * The tab is back. Read first -- that alone ends an elevation that ran out
     * while it was away, with no request and no network to depend on -- then
     * ask the server for what the read cannot know: a grant or a drop made
     * elsewhere, or a lifetime the server moved.
     */
    private reconcile(): void {
        this.state();
        if (!this.available) return;

        const now = Date.now();
        if (now - this.lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) return;
        this.lastReconcileAt = now;

        this.refresh().subscribe({ error: () => undefined });
    }
}

/** Whether a stored answer has gone past the moment the server named. */
function isPast(state: ElevationState): boolean {
    if (!state.elevated || !state.expiresAt) return false;

    const at = Date.parse(state.expiresAt);
    // Unparseable is not expired: a date this client cannot read is a reason to
    // keep asking the server, not to end an elevation it may still be granting.
    return Number.isFinite(at) && at <= Date.now();
}

/**
 * The same answer, read after its own `expiresAt`: what the server would say
 * if asked now, down to `ended`, so a prompt opened from it explains itself
 * the same way whether the news came from the read or from the endpoint.
 */
function expiredView(state: ElevationState): ElevationState {
    return {
        ...state,
        elevated: false,
        expiresAt: null,
        grantedAt: null,
        factorConfirmed: null,
        ended: { reason: 'expired', at: state.expiresAt ?? null },
    };
}

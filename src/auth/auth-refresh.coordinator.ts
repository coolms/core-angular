import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { type Observable, catchError, defer, finalize, firstValueFrom, from, shareReplay, throwError } from 'rxjs';

import { IdentityApiClient } from '../api/identity-api.client';
import { AuthState } from './auth.state';
import { Logout, SetTokens } from './auth.actions';

const LOCK_NAME = 'coolms_auth_refresh';
const FRESH_TOKEN_GRACE_MS = 30_000;

/** Where AuthState persists the session, shared by every tab of the origin. */
const STORAGE_KEY = 'coolms_token';

interface SharedTokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
}

/**
 * Two-layer refresh coordinator: an intra-tab `shareReplay(1)`
 * mutex dedupes concurrent callers within one tab, and a
 * cross-tab `navigator.locks` wrapper ensures only one tab in
 * the browser issues the actual `POST /auth/refresh` at a time.
 *
 * Without the cross-tab layer, two tabs racing the same expired
 * refresh-token both POST `/auth/refresh`; the backend's
 * `isUsed` replay branch revokes every token for the user on
 * the second arrival and the operator is kicked to /login.
 *
 * The Web Lock body re-reads the current access-token expiry from
 * `AuthState` before issuing the HTTP call. When this tab waited
 * behind another tab's refresh, that tab's `SetTokens` dispatch
 * has already published fresh values into shared `localStorage`,
 * `CrossTabAuthSyncService` has mirrored them into this tab's
 * NGXS state, and the lock body simply returns the cached access
 * token without another network round-trip.
 *
 * `Logout` fires only when the refresh endpoint returns 401
 * (real auth failure). Transient errors (network blips, 5xx,
 * CORS, timeouts) propagate without clearing the session so a
 * momentary refresh failure does not kill a valid login.
 *
 * A token the server REFUSED (2026-09-26). A caller answering a 401
 * passes the access token that was refused. Until then the lock body
 * handed back the cached token whenever its expiry looked fresh --
 * which a revoked token's does: a session ended on the server (a
 * sign-out everywhere from another device, a password change) was
 * retried with the same dead token and never refreshed, so the client
 * stayed signed in, and in its calls, until the token neared expiry
 * (measured: a 1:1 call kept for the whole 30 s window, every request
 * answered 401). Now the lock body re-reads the SHARED copy
 * (`localStorage`, which every tab's `SetTokens` writes synchronously;
 * this tab's state only follows a sibling's write when its `storage`
 * event arrives):
 *   - a different access token there -> another tab (or an earlier
 *     refresh here) already rotated past the refused one: use it, no
 *     request;
 *   - the same one -> the server refused this token: refresh, with the
 *     newest refresh token -- the shared one, so a rotation a sibling
 *     made is never replayed with the token it consumed. A 401 there
 *     is the session's end: `Logout`.
 */
@Injectable({ providedIn: 'root' })
export class AuthRefreshCoordinator {
    private readonly api = inject(IdentityApiClient);
    private readonly store = inject(Store);
    private readonly router = inject(Router);

    private inFlight: Observable<string> | null = null;

    /**
     * Return the in-flight refresh Observable, or spawn a new one
     * with the supplied refresh-token value.
     *
     * `refusedAccessToken`: the access token the server just answered
     * 401 to, when the caller is answering one. With it, the lock body
     * refreshes unless the shared copy already holds another token;
     * without it (a preemptive refresh), a fresh-looking cached token
     * is handed back as before.
     *
     * Callers subscribe via `switchMap` / `firstValueFrom` to retry
     * their original request with the resolved access token.
     */
    refresh(refreshToken: string, refusedAccessToken: string | null = null): Observable<string> {
        if (this.inFlight) {
            return this.inFlight;
        }
        this.inFlight = defer(() => this.refreshWithCrossTabLock(refreshToken, refusedAccessToken)).pipe(
            catchError(refreshErr => {
                const isAuthFailure = refreshErr instanceof HttpErrorResponse && refreshErr.status === 401;
                if (isAuthFailure) {
                    this.store.dispatch(new Logout());
                    if (this.router.navigated) {
                        void this.router.navigate(['/login']);
                    }
                }
                return throwError(() => refreshErr);
            }),
            shareReplay(1),
            finalize(() => {
                this.inFlight = null;
            }),
        );
        return this.inFlight;
    }

    /**
     * Run the refresh body inside `navigator.locks` when the API is
     * available; degrade to direct invocation otherwise. The lock
     * body checks for state already updated by a sibling tab before
     * issuing its own HTTP call.
     */
    private refreshWithCrossTabLock(refreshToken: string, refusedAccessToken: string | null): Observable<string> {
        const lockBody = (): Promise<string> => this.executeRefresh(refreshToken, refusedAccessToken);

        if (typeof navigator === 'undefined' || !('locks' in navigator)) {
            return from(lockBody());
        }
        return from(
            navigator.locks.request(LOCK_NAME, lockBody).then(value => {
                if (value === undefined) {
                    throw new Error('Refresh lock aborted before completing.');
                }
                return value;
            }),
        );
    }

    /**
     * Lock body. Re-reads the shared copy first (see the class note).
     *
     * Answering a refusal: a shared access token other than the refused
     * one is a rotation already made -- taken, and mirrored into this
     * tab's state if its `storage` event has not arrived yet. Otherwise,
     * or for a preemptive caller whose cached token no longer looks
     * fresh, the HTTP refresh, with the newest refresh token: shared,
     * then state, then the caller's.
     */
    private async executeRefresh(originalRefreshToken: string, refusedAccessToken: string | null): Promise<string> {
        const shared = this.readShared();
        if (refusedAccessToken !== null) {
            if (shared !== null && shared.accessToken !== refusedAccessToken) {
                if (this.store.selectSnapshot(AuthState.accessToken) !== shared.accessToken) {
                    this.store.dispatch(new SetTokens(shared));
                }
                return shared.accessToken;
            }
        } else {
            const cachedAccess = this.tryConsumeFreshState(shared);
            if (cachedAccess !== null) {
                return cachedAccess;
            }
        }
        const currentRefreshToken = shared?.refreshToken
            ?? this.store.selectSnapshot(AuthState.refreshToken)
            ?? originalRefreshToken;
        const response = await firstValueFrom(this.api.refresh(currentRefreshToken));
        this.store.dispatch(new SetTokens(response));
        return response.accessToken;
    }

    /**
     * The session as the tabs share it, or null when there is none to
     * read: no storage, nothing stored (signed out), or a value that is
     * not a complete token set.
     */
    private readShared(): SharedTokens | null {
        let raw: string | null;
        try {
            raw = localStorage.getItem(STORAGE_KEY);
        } catch {
            return null;
        }
        if (raw === null) {
            return null;
        }
        try {
            const parsed = JSON.parse(raw) as Partial<SharedTokens> | null;
            if (typeof parsed?.accessToken !== 'string' || typeof parsed.refreshToken !== 'string' || typeof parsed.expiresAt !== 'string') {
                return null;
            }
            return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresAt: parsed.expiresAt };
        } catch {
            return null;
        }
    }

    /**
     * For a preemptive caller only: return the current access token when
     * its expiry is more than `FRESH_TOKEN_GRACE_MS` milliseconds away --
     * signalling that some other tab refreshed for us. The shared copy
     * first, which a sibling's rotation reaches before this tab's state
     * does (mirrored here when it is newer); this tab's state when there
     * is none. Null otherwise. Never asked for a token the server
     * refused: a refused token's expiry looks just as fresh.
     */
    private tryConsumeFreshState(shared: SharedTokens | null): string | null {
        const accessToken = shared?.accessToken ?? this.store.selectSnapshot(AuthState.accessToken);
        const expiresAtStr = shared?.expiresAt ?? this.store.selectSnapshot(AuthState.expiresAt);
        if (accessToken === null || expiresAtStr === null) {
            return null;
        }
        const expiresAtMs = new Date(expiresAtStr).getTime();
        if (Number.isNaN(expiresAtMs)) {
            return null;
        }
        if (Date.now() >= expiresAtMs - FRESH_TOKEN_GRACE_MS) {
            return null;
        }
        if (shared !== null && this.store.selectSnapshot(AuthState.accessToken) !== shared.accessToken) {
            this.store.dispatch(new SetTokens(shared));
        }
        return accessToken;
    }
}

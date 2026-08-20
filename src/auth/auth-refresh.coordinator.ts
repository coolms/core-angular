import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { Observable, catchError, defer, finalize, firstValueFrom, from, shareReplay, throwError } from 'rxjs';

import { IdentityApiClient } from '../api/identity-api.client';
import { AuthState } from './auth.state';
import { Logout, SetTokens } from './auth.actions';

const LOCK_NAME = 'coolms_auth_refresh';
const FRESH_TOKEN_GRACE_MS = 30_000;

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
     * Callers subscribe via `switchMap` / `firstValueFrom` to retry
     * their original request with the resolved access token.
     */
    refresh(refreshToken: string): Observable<string> {
        if (this.inFlight) {
            return this.inFlight;
        }
        this.inFlight = defer(() => this.refreshWithCrossTabLock(refreshToken)).pipe(
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
    private refreshWithCrossTabLock(refreshToken: string): Observable<string> {
        const lockBody = (): Promise<string> => this.executeRefresh(refreshToken);

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
     * Lock body. Re-reads `AuthState.expiresAt` first: if another
     * tab published fresh tokens while we were queued, return the
     * cached access token directly. Otherwise read the latest
     * refresh-token value from state (it may have rotated while we
     * waited) and issue the HTTP refresh.
     */
    private async executeRefresh(originalRefreshToken: string): Promise<string> {
        const cachedAccess = this.tryConsumeFreshState();
        if (cachedAccess !== null) {
            return cachedAccess;
        }
        const currentRefreshToken = this.store.selectSnapshot(AuthState.refreshToken) ?? originalRefreshToken;
        const response = await firstValueFrom(this.api.refresh(currentRefreshToken));
        this.store.dispatch(new SetTokens(response));
        return response.accessToken;
    }

    /**
     * Return the cached access token when `AuthState.expiresAt` has
     * more than `FRESH_TOKEN_GRACE_MS` milliseconds remaining --
     * signalling that some other tab refreshed for us. Null
     * otherwise.
     */
    private tryConsumeFreshState(): string | null {
        const accessToken = this.store.selectSnapshot(AuthState.accessToken);
        const expiresAtStr = this.store.selectSnapshot(AuthState.expiresAt);
        if (accessToken === null || expiresAtStr === null) {
            return null;
        }
        const expiresAtMs = new Date(expiresAtStr).getTime();
        if (Number.isNaN(expiresAtMs)) {
            return null;
        }
        if (Date.now() < expiresAtMs - FRESH_TOKEN_GRACE_MS) {
            return accessToken;
        }
        return null;
    }
}

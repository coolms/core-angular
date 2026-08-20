import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';

import type { AuthStateModel } from './auth.state';
import { Logout, SetTokens } from './auth.actions';
import type { TokenResponse } from '../api/auth.types';

const STORAGE_KEY = 'coolms_token';

/**
 * Bridges shared `localStorage` mutations into the NGXS auth
 * state so a refresh executed in one tab silently propagates to
 * every other open tab.
 *
 * The browser fires `storage` events in tabs OTHER than the one
 * that mutated `localStorage`. So when Tab A's
 * `AuthRefreshCoordinator` rotates the token pair and `SetTokens`
 * persists the new values, every sibling tab receives an event
 * here and dispatches `SetTokens` against its own NGXS state --
 * no extra HTTP roundtrip, no extra refresh contention.
 *
 * Pairs with the `navigator.locks` cross-tab mutex in
 * `AuthRefreshCoordinator`: locks ensure only one tab issues the
 * refresh, this listener propagates the result to the rest.
 *
 * `Logout` from any tab clears `coolms_token` (newValue === null)
 * and this listener mirrors that into the sibling tabs so the
 * shell redirects to `/login` without waiting for the next
 * protected request to 401.
 *
 * Started from `AppInitService.load()` so the listener is in
 * place before any protected HTTP fires.
 */
@Injectable({ providedIn: 'root' })
export class CrossTabAuthSyncService {
    private readonly store = inject(Store);
    private listenerAttached = false;

    start(): void {
        if (this.listenerAttached) {
            return;
        }
        this.listenerAttached = true;
        window.addEventListener('storage', this.handleStorageEvent);
    }

    private readonly handleStorageEvent = (event: StorageEvent): void => {
        if (event.key !== STORAGE_KEY) {
            return;
        }
        // Sibling tab cleared the key (logout dispatch or
        // RestoreSession parse-error cleanup). Mirror the clear so
        // this tab does not keep operating against a revoked
        // server-side session.
        if (event.newValue === null) {
            this.store.dispatch(new Logout());
            return;
        }
        // Parse the new value and dispatch SetTokens so this tab's
        // in-memory NGXS state reflects what the originating tab
        // just wrote. Malformed payloads are ignored.
        let parsed: AuthStateModel;
        try {
            parsed = JSON.parse(event.newValue) as AuthStateModel;
        } catch {
            return;
        }
        if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string' || typeof parsed.expiresAt !== 'string') {
            return;
        }
        const tokenResponse: TokenResponse = {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            expiresAt: parsed.expiresAt,
            user: parsed.user ?? undefined,
        };
        this.store.dispatch(new SetTokens(tokenResponse));
    };
}

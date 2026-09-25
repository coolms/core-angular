import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Store, provideStore } from '@ngxs/store';
import { type Observable, firstValueFrom, of, throwError } from 'rxjs';

import { IdentityApiClient } from '../api/identity-api.client';
import type { TokenResponse } from '../api/auth.types';
import { UserPreferencesService } from '../services/user-preferences.service';
import { AuthRefreshCoordinator } from './auth-refresh.coordinator';
import { AuthState } from './auth.state';
import { SetTokens } from './auth.actions';

/**
 * A token the server refused is refreshed, not handed back (2026-09-26).
 *
 * The lock body used to return the cached access token whenever its expiry
 * looked fresh -- which a REVOKED token's does. A session ended on the server
 * (a sign-out everywhere from another device) was retried with the same dead
 * token and never refreshed: measured on the served admin, a signed-out
 * party's client stayed signed in, and in its call, for the whole 30 s window
 * with every request answered 401.
 *
 * The real NGXS AuthState, so SetTokens writes the shared copy
 * (`localStorage['coolms_token']`) as it does in the application, and the
 * browser's own `navigator.locks`.
 */
describe('AuthRefreshCoordinator', () => {
    const KEY = 'coolms_token';
    const soon = (s: number): string => new Date(Date.now() + s * 1000).toISOString();

    let refreshes: string[];
    let answer: (token: string) => Observable<TokenResponse>;
    let navigated: unknown[][];

    const pair = (n: number): TokenResponse => ({ accessToken: 'access-' + n, refreshToken: 'refresh-' + n, expiresAt: soon(900) });

    beforeEach(() => {
        localStorage.removeItem(KEY);
        refreshes = [];
        navigated = [];
        answer = () => of(pair(2));
        TestBed.configureTestingModule({
            providers: [
                provideStore([AuthState]),
                {
                    provide: IdentityApiClient,
                    useValue: {
                        refresh: (token: string) => {
                            refreshes.push(token);
                            return answer(token);
                        },
                    },
                },
                { provide: UserPreferencesService, useValue: { loadFromServer: () => undefined } },
                { provide: Router, useValue: { navigated: true, navigate: (c: unknown[]) => navigated.push(c) } },
            ],
        });
    });

    afterEach(() => localStorage.removeItem(KEY));

    /** This tab signed in with pair 1, its access token with 15 minutes left (or `left` seconds). */
    function signedIn(left = 900): Store {
        const store = TestBed.inject(Store);
        store.dispatch(new SetTokens({ ...pair(1), expiresAt: soon(left) }));
        expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').accessToken).withContext('the subject: the shared copy').toBe('access-1');
        return store;
    }

    it('refreshes when the refused token is still the current one, however fresh it looks', async () => {
        const store = signedIn();

        const token = await firstValueFrom(TestBed.inject(AuthRefreshCoordinator).refresh('refresh-1', 'access-1'));

        expect(refreshes).toEqual(['refresh-1']);
        expect(token).toBe('access-2');
        expect(store.selectSnapshot(AuthState.accessToken)).toBe('access-2');
    });

    it('ends the session when that refresh is refused', async () => {
        const store = signedIn();
        answer = () => throwError(() => new HttpErrorResponse({ status: 401 }));

        await expectAsync(firstValueFrom(TestBed.inject(AuthRefreshCoordinator).refresh('refresh-1', 'access-1'))).toBeRejected();

        expect(store.selectSnapshot(AuthState.isAuthenticated)).toBeFalse();
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(navigated).toEqual([['/login']]);
    });

    it('takes a rotation another tab already made, without a request, and mirrors it here', async () => {
        const store = signedIn();
        // A sibling tab rotated: the shared copy moved on, this tab's state has not
        // heard yet (its storage event is still to come).
        localStorage.setItem(KEY, JSON.stringify({ ...pair(3), user: null }));

        const token = await firstValueFrom(TestBed.inject(AuthRefreshCoordinator).refresh('refresh-1', 'access-1'));

        expect(refreshes).toEqual([], 'no second refresh: refresh-1 was consumed by the sibling');
        expect(token).toBe('access-3');
        expect(store.selectSnapshot(AuthState.accessToken)).toBe('access-3');
    });

    it('refreshes with the shared refresh token, never one a sibling already consumed', async () => {
        signedIn(10);
        // A sibling rotated to pair 3, which is near its expiry too; this tab's state
        // still holds pair 1.
        localStorage.setItem(KEY, JSON.stringify({ ...pair(3), expiresAt: soon(10), user: null }));

        // A preemptive caller (no refusal) holding the state's stale refresh-1.
        await firstValueFrom(TestBed.inject(AuthRefreshCoordinator).refresh('refresh-1'));

        expect(refreshes).toEqual(['refresh-3']);
    });

    it('keeps the preemptive shortcut: no refusal and a fresh cached token means no request', async () => {
        signedIn();

        const token = await firstValueFrom(TestBed.inject(AuthRefreshCoordinator).refresh('refresh-1'));

        expect(refreshes).toEqual([]);
        expect(token).toBe('access-1');
    });

    it('a preemptive caller takes a fresh pair a sibling already rotated to, before its own state hears', async () => {
        const store = signedIn(10);
        localStorage.setItem(KEY, JSON.stringify({ ...pair(3), user: null }));

        const token = await firstValueFrom(TestBed.inject(AuthRefreshCoordinator).refresh('refresh-1'));

        expect(refreshes).toEqual([], 'no rotation: the sibling made one');
        expect(token).toBe('access-3');
        expect(store.selectSnapshot(AuthState.accessToken)).toBe('access-3');
    });
});

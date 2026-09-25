import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Store, provideStore } from '@ngxs/store';
import { of, throwError } from 'rxjs';

import { IdentityApiClient } from '../api/identity-api.client';
import type { TokenResponse } from '../api/auth.types';
import { AppInitService } from '../bootstrap/app-init.service';
import { UserPreferencesService } from '../services/user-preferences.service';
import { authInterceptor } from './auth.interceptor';
import { AuthState } from './auth.state';
import { SetTokens } from './auth.actions';

/**
 * A 401 on a token whose expiry still looks fresh is the server saying this
 * session is over (a sign-out everywhere from another device), and the
 * interceptor must let the refresh find out (2026-09-26). It hands the refused
 * token to the coordinator; until then the coordinator handed that same token
 * back and the request was retried with it, forever 401, never signed out.
 */
describe('authInterceptor -- a refused token', () => {
    const KEY = 'coolms_token';
    const soon = (s: number): string => new Date(Date.now() + s * 1000).toISOString();

    let http: HttpTestingController;
    let refreshes: string[];
    let refreshAnswer: () => ReturnType<IdentityApiClient['refresh']>;

    beforeEach(() => {
        localStorage.removeItem(KEY);
        refreshes = [];
        refreshAnswer = () => of<TokenResponse>({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: soon(900) });
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([authInterceptor])),
                provideHttpClientTesting(),
                provideStore([AuthState]),
                {
                    provide: IdentityApiClient,
                    useValue: {
                        refresh: (token: string) => {
                            refreshes.push(token);
                            return refreshAnswer();
                        },
                    },
                },
                { provide: UserPreferencesService, useValue: { loadFromServer: () => undefined } },
                { provide: AppInitService, useValue: { ready$: of(true) } },
                { provide: Router, useValue: { navigated: true, navigate: () => Promise.resolve(true) } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        TestBed.inject(Store).dispatch(new SetTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: soon(900) }));
    });

    afterEach(() => {
        http.verify();
        localStorage.removeItem(KEY);
    });

    /** Resolves once the lock-guarded refresh has run and the retry is out. */
    const retried = async (): Promise<ReturnType<HttpTestingController['expectOne']>> => {
        for (let i = 0; i < 50; i++) {
            const pending = http.match('/api/v1/notifications');
            if (pending.length > 0) {
                return pending[0];
            }
            await new Promise(r => setTimeout(r, 10));
        }
        return http.expectOne('/api/v1/notifications');
    };

    it('refreshes and retries with the new token', async () => {
        let body: unknown = null;
        TestBed.inject(HttpClient).get('/api/v1/notifications').subscribe(b => (body = b));

        const first = http.expectOne('/api/v1/notifications');
        expect(first.request.headers.get('Authorization')).toBe('Bearer access-1');
        first.flush(null, { status: 401, statusText: 'Unauthorized' });

        const again = await retried();
        expect(refreshes).toEqual(['refresh-1'], 'the refused token was refreshed, not handed back');
        expect(again.request.headers.get('Authorization')).toBe('Bearer access-2');
        again.flush({ ok: true });
        expect(body).toEqual({ ok: true });
    });

    it('signs this client out when the refresh is refused too', async () => {
        refreshAnswer = () => throwError(() => new HttpErrorResponse({ status: 401 }));
        let failed = false;
        TestBed.inject(HttpClient).get('/api/v1/notifications').subscribe({ error: () => (failed = true) });

        http.expectOne('/api/v1/notifications').flush(null, { status: 401, statusText: 'Unauthorized' });
        for (let i = 0; i < 50 && !failed; i++) {
            await new Promise(r => setTimeout(r, 10));
        }

        expect(failed).toBeTrue();
        expect(TestBed.inject(Store).selectSnapshot(AuthState.isAuthenticated)).toBeFalse();
    });
});

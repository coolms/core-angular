import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { AUTH_AUDIENCE } from './auth-audience';
import { IdentityApiClient } from './identity-api.client';

/**
 * A sign-in names the application's audience when the application provides one, and only then: an application that
 * provides none signs in exactly as before.
 */
describe('IdentityApiClient -- a sign-in names its audience', () => {
    const LOGIN = '/api/v1/auth/login';
    let http: HttpTestingController;

    function client(audience?: string): IdentityApiClient {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1', auth: { login: LOGIN } }) } },
                ...(audience === undefined ? [] : [{ provide: AUTH_AUDIENCE, useValue: audience }]),
            ],
        });
        http = TestBed.inject(HttpTestingController);

        return TestBed.inject(IdentityApiClient);
    }

    afterEach(() => http.verify());

    it('sends the audience the application provides', () => {
        client('admin').login('ann@example.com', 'secret').subscribe();

        expect(http.expectOne(LOGIN).request.body).toEqual({
            identifier: 'ann@example.com', password: 'secret', audience: 'admin',
        });
    });

    it('sends no audience when the application provides none', () => {
        client().login('ann@example.com', 'secret').subscribe();

        expect(http.expectOne(LOGIN).request.body).toEqual({ identifier: 'ann@example.com', password: 'secret' });
    });
});

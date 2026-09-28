import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { firstValueFrom } from 'rxjs';
import { ConsoleAccessService, type ConsoleAccess } from '../bootstrap/console-access.service';
import { RealtimeTokenClient } from './realtime-token.client';

/**
 * Access first, then realtime (Dmitry, 2026-09-28): the realtime socket opens with the
 * connection token, so the token is not asked for until the console has answered, and a
 * refused sign-in gets none. Measured before: a refused account opened a realtime socket
 * before the console's 403 signed it out.
 *
 * The control is the granted answer: the same instrument sees the token request made.
 */
describe('RealtimeTokenClient -- access first, then realtime', () => {
    let answer: (access: ConsoleAccess) => void;
    let http: HttpTestingController;
    const URL = '/api/v1/centrifugo/connection-token';

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }) } },
                {
                    provide: ConsoleAccessService,
                    useValue: { ensure: () => new Promise<ConsoleAccess>(resolve => { answer = resolve; }) },
                },
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('asks for no connection token while the console has not answered, and asks once it grants', async () => {
        const token = firstValueFrom(TestBed.inject(RealtimeTokenClient).connectionToken());
        await Promise.resolve();
        http.expectNone(URL);

        answer('granted');
        await Promise.resolve();
        await Promise.resolve();
        http.expectOne(URL).flush({ token: 't', expiresAt: 0, ttl: 60, wsUrl: 'ws://x' });
        expect((await token).token).toBe('t');
    });

    it('asks for no connection token at all when the console refuses the sign-in', async () => {
        const token = firstValueFrom(TestBed.inject(RealtimeTokenClient).connectionToken());
        answer('refused');
        await expectAsync(token).toBeRejectedWithError(RealtimeTokenClient.REFUSED);
        http.expectNone(URL);
    });
});

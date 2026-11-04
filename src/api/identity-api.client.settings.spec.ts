import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { IdentityApiClient } from './identity-api.client';

/**
 * Several services read the person's settings at start-up, each for its own section. Callers that ask while a read is
 * in flight share it -- one request -- and a call after it has answered reads again, so nothing old is kept.
 */
describe('IdentityApiClient -- one settings read for the callers that ask together', () => {
    const SETTINGS = '/api/v1/auth/me/settings';
    let http: HttpTestingController;
    let client: IdentityApiClient;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1', identity: { settingsUrl: SETTINGS } }) } },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        client = TestBed.inject(IdentityApiClient);
    });

    afterEach(() => http.verify());

    it('two callers asking while a read is in flight share one request, and both get its answer', () => {
        const got: unknown[] = [];
        client.getSettings().subscribe(v => got.push(v['calendar']));
        client.getSettings().subscribe(v => got.push(v['call']));

        const read = http.expectOne(SETTINGS);
        expect(read.request.headers.get('Accept')).toBe('application/json');
        read.flush({ calendar: { weekStart: 'monday' }, call: { overlayEnabled: true } });

        expect(got).toEqual([{ weekStart: 'monday' }, { overlayEnabled: true }]);
    });

    it('a call after the read has answered reads again', () => {
        client.getSettings().subscribe();
        http.expectOne(SETTINGS).flush({ calendar: { weekStart: 'monday' } });

        let later: unknown;
        client.getSettings().subscribe(v => (later = v['calendar']));
        http.expectOne(SETTINGS).flush({ calendar: { weekStart: 'sunday' } });

        expect(later).toEqual({ weekStart: 'sunday' });
    });

    it('a failed read is not kept: the next call reads again', () => {
        let failed = false;
        client.getSettings().subscribe({ error: () => (failed = true) });
        http.expectOne(SETTINGS).flush({ title: 'Unavailable' }, { status: 503, statusText: 'Unavailable' });
        expect(failed).toBeTrue();

        client.getSettings().subscribe();
        http.expectOne(SETTINGS).flush({});
    });
});

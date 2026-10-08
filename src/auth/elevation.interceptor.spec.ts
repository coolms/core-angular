import { TestBed } from '@angular/core/testing';
import {
    HttpClient, HttpContext, HttpErrorResponse, type HttpInterceptorFn, provideHttpClient, withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { type Observable, of } from 'rxjs';
import { elevationInterceptor } from './elevation.interceptor';
import { BACKGROUND_REQUEST, BYPASS_ELEVATION } from './elevation.service';
import { ELEVATION_NOTICE, ELEVATION_PROMPT, type ElevationPromptRequest } from './elevation-prompt.port';

/**
 * The elevation prompt opens only when a person asks for it: a request made on page load or in the
 * background that gets a 403 never opens it.
 *
 * Coverage:
 *   1. A stamped 403 on a read -- what a page makes as it loads, what a poll makes -- opens nothing and
 *      tells nothing; the caller receives the 403 and shows its own state.
 *   2. The same on a background write (a realtime token, a preferences sync).
 *   3. A stamped 403 on a write a person made tells the notice once, with the server's sentence; it
 *      never opens the prompt, never reads the elevation state, and never repeats the request. The
 *      caller receives the 403 at once.
 *   4. A 403 without the stamp, a stamp from another origin, and the elevation endpoint's own 403
 *      tell nothing.
 *   5. With no notice bound, a refusal is only a 403.
 * In every case the prompt port, bound throughout, is opened zero times.
 */
describe('elevationInterceptor', () => {
    let http: HttpClient;
    let httpMock: HttpTestingController;
    let opened: ElevationPromptRequest[];
    let told: string[];

    const ELEVATION = '/api/v1/auth/elevation';
    const manifest  = { apiBase: '/api/v1', identity: { elevationUrl: ELEVATION } };

    const setup = (withNotice = true): void => {
        opened = [];
        told   = [];
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([elevationInterceptor as HttpInterceptorFn])),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => manifest } },
                {
                    provide: ELEVATION_PROMPT,
                    useValue: { open: (r: ElevationPromptRequest) => { opened.push(r); return of(true); } },
                },
                ...(withNotice ? [{
                    provide: ELEVATION_NOTICE,
                    useValue: { refused: (refusal: string) => { told.push(refusal); } },
                }] : []),
            ],
        });
        http     = TestBed.inject(HttpClient);
        httpMock = TestBed.inject(HttpTestingController);
    };

    afterEach(() => {
        // Not one refusal, of any kind, opened the prompt, and nothing asked for the elevation state.
        expect(opened.length).toBe(0);
        httpMock.expectNone(ELEVATION);
        httpMock.verify();
    });

    /** A 403 the server stamped: refused by the named gate for want of elevation. */
    const refuse = (url: string, detail = "Permission denied: cannot write '/docs/a.md'", gate = 'vfs.permission'): void => {
        httpMock.expectOne(url).flush({ detail }, { status: 403, statusText: 'Forbidden', headers: { 'X-Elevation-Required': gate } });
    };

    /** Subscribes, and holds the status of the error the caller receives. */
    const errorOf = (source: Observable<unknown>): { status?: number } => {
        const received: { status?: number } = {};
        source.subscribe({ error: (e: HttpErrorResponse) => { received.status = e.status; } });
        return received;
    };

    it('opens nothing and tells nothing when a page-load read is refused (a Mail reload asks for workflow definitions)', () => {
        setup();
        const error = errorOf(http.get('/api/v1/definitions?module=workflow&itemsPerPage=200'));

        refuse('/api/v1/definitions?module=workflow&itemsPerPage=200', 'Access Denied.', 'identity.administrator_role');

        expect(told).toEqual([]);
        expect(error.status).toBe(403);
    });

    it('opens nothing and tells nothing when a background write is refused (a realtime subscription token)', () => {
        setup();
        const background = { context: new HttpContext().set(BACKGROUND_REQUEST, true) };
        const error = errorOf(http.post('/api/v1/centrifugo/subscription-token', { channel: 'x' }, background));

        refuse('/api/v1/centrifugo/subscription-token', 'Access Denied.', 'identity.administrator_role');

        expect(told).toEqual([]);
        expect(error.status).toBe(403);
    });

    it('tells the notice once, with the server\'s sentence, when a write a person made is refused, and does not repeat it', () => {
        setup();
        const error = errorOf(http.delete('/api/v1/vfs/nodes?path=/docs/a.md'));

        refuse('/api/v1/vfs/nodes?path=/docs/a.md');

        expect(told).toEqual(["Permission denied: cannot write '/docs/a.md'"]);
        expect(error.status).toBe(403);
        httpMock.expectNone('/api/v1/vfs/nodes?path=/docs/a.md');
    });

    it('tells the notice in readable words when the server wrote only the framework\'s refusal', () => {
        setup();
        errorOf(http.put('/api/v1/themes/site', {}));

        refuse('/api/v1/themes/site', 'Access Denied.', 'identity.administrator_role');

        expect(told).toEqual(['This needs an elevated session.']);
    });

    it('tells nothing for a 403 the server did not stamp', () => {
        setup();
        const error = errorOf(http.post('/api/v1/vfs/directories', { path: '/docs/new' }));

        httpMock.expectOne('/api/v1/vfs/directories').flush({ detail: 'You may not.' }, { status: 403, statusText: 'Forbidden' });

        expect(told).toEqual([]);
        expect(error.status).toBe(403);
    });

    it('tells nothing for a stamp from another origin', () => {
        setup();
        errorOf(http.post('https://elsewhere.example/api/v1/x', {}));

        refuse('https://elsewhere.example/api/v1/x');

        expect(told).toEqual([]);
    });

    it('tells nothing for the elevation endpoint\'s own 403 (a wrong password)', () => {
        setup();
        const bypass = { context: new HttpContext().set(BYPASS_ELEVATION, true) };
        errorOf(http.post('/api/v1/auth/elevation-grant', { password: 'x' }, bypass));

        refuse('/api/v1/auth/elevation-grant', 'Wrong password.');

        expect(told).toEqual([]);
    });

    it('leaves a refusal a plain 403 when no notice is bound', () => {
        setup(false);
        const error = errorOf(http.delete('/api/v1/vfs/nodes?path=/docs/b.md'));

        refuse('/api/v1/vfs/nodes?path=/docs/b.md');

        expect(error.status).toBe(403);
    });
});

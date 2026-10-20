import { TestBed } from '@angular/core/testing';
import {
    HttpClient, HttpContext, HttpErrorResponse, HttpRequest, type HttpInterceptorFn, provideHttpClient, withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { type Observable, of } from 'rxjs';
import { actionOf, elevationInterceptor } from './elevation.interceptor';
import { BACKGROUND_REQUEST, BYPASS_ELEVATION } from './elevation.service';
import { ELEVATION_ACTION, ELEVATION_NOTICE, ELEVATION_PROMPT, type ElevationPromptRequest } from './elevation-prompt.port';

/**
 * A write a person made that the server refuses for want of elevation opens the prompt THERE, and is sent once more
 * when they elevate (decided 2026-10-20) -- the edit they were in stays open beneath the prompt, and the save
 * completes. Nothing a page makes as it loads, and nothing in the background, opens it (decided 2026-10-08).
 *
 * Coverage:
 *   1. A stamped 403 on a read, or on a background write, opens nothing and tells nothing.
 *   2. A person's refused write opens the prompt once, with the server's sentence and the action; on a grant it is
 *      sent once more and the caller receives THAT answer; nothing is told.
 *   3. Declined: the notice is told -- the sentence and the action -- and the caller receives the 403; not repeated.
 *   4. Elevated already (another tab): sent once more, no prompt.
 *   5. A second refusal of the repeat is a 403 to the caller, never a second prompt.
 *   6. With no prompt bound, the notice is told at once and the caller receives the 403.
 *   7. A 403 without the stamp, a stamp from another origin, and the elevation endpoint's own 403 do nothing.
 *   8. The action: what the caller named, or the verb and the resource the URL names.
 */
describe('elevationInterceptor', () => {
    let http: HttpClient;
    let httpMock: HttpTestingController;
    let opened: ElevationPromptRequest[];
    let told: Array<{ refusal: string; action?: string }>;
    let grant: boolean;

    const ELEVATION = '/api/v1/auth/elevation';
    const manifest  = { apiBase: '/api/v1', identity: { elevationUrl: ELEVATION } };
    const state = (elevated: boolean) => ({
        elevated, expiresAt: null, grantedAt: null, ended: null, lifetimeSeconds: 900, mfaRequired: false, warnings: [],
    });

    const setup = (options: { notice?: boolean; prompt?: boolean } = {}): void => {
        opened = [];
        told   = [];
        grant  = true;
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([elevationInterceptor as HttpInterceptorFn])),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => manifest } },
                ...(options.prompt === false ? [] : [{
                    provide: ELEVATION_PROMPT,
                    useValue: { open: (r: ElevationPromptRequest) => { opened.push(r); return of(grant); } },
                }]),
                ...(options.notice === false ? [] : [{
                    provide: ELEVATION_NOTICE,
                    useValue: { refused: (refusal: string, action?: string) => { told.push({ refusal, action }); } },
                }]),
            ],
        });
        http     = TestBed.inject(HttpClient);
        httpMock = TestBed.inject(HttpTestingController);
    };

    afterEach(() => httpMock.verify());

    /** A 403 the server stamped: refused by the named gate for want of elevation. */
    const refuse = (url: string, detail = "Permission denied: cannot write '/docs/a.md'", gate = 'vfs.permission'): void => {
        httpMock.expectOne(url).flush({ detail }, { status: 403, statusText: 'Forbidden', headers: { 'X-Elevation-Required': gate } });
    };

    /** Subscribes, and holds what the caller receives: the answer's body, or the error's status. */
    const outcomeOf = (source: Observable<unknown>): { status?: number; body?: unknown } => {
        const received: { status?: number; body?: unknown } = {};
        source.subscribe({
            next: (b) => { received.body = b; },
            error: (e: HttpErrorResponse) => { received.status = e.status; },
        });
        return received;
    };

    it('opens nothing and tells nothing when a page-load read is refused', () => {
        setup();
        const out = outcomeOf(http.get('/api/v1/definitions?module=workflow&itemsPerPage=200'));

        refuse('/api/v1/definitions?module=workflow&itemsPerPage=200', 'Access Denied.', 'identity.administrator_role');

        expect(opened).toEqual([]);
        expect(told).toEqual([]);
        expect(out.status).toBe(403);
        httpMock.expectNone(ELEVATION);
    });

    it('opens nothing and tells nothing when a background write is refused (a realtime token)', () => {
        setup();
        const background = { context: new HttpContext().set(BACKGROUND_REQUEST, true) };
        const out = outcomeOf(http.post('/api/v1/centrifugo/subscription-token', { channel: 'x' }, background));

        refuse('/api/v1/centrifugo/subscription-token', 'Access Denied.', 'identity.administrator_role');

        expect(opened).toEqual([]);
        expect(told).toEqual([]);
        expect(out.status).toBe(403);
        httpMock.expectNone(ELEVATION);
    });

    it('opens the prompt for a person\'s refused write and, once they elevate, sends it again and answers with that', () => {
        setup();
        const out = outcomeOf(http.patch('/api/v1/navi/nodes/0192f0a1-1111-7000-8000-000000000001', { title: 'Home' }));

        refuse('/api/v1/navi/nodes/0192f0a1-1111-7000-8000-000000000001', 'Access Denied.', 'identity.administrator_role');
        httpMock.expectOne(ELEVATION).flush(state(false));

        expect(opened.length).toBe(1);
        expect(opened[0].refusal).toBe('This needs an elevated session.');
        expect(opened[0].action).toBe('Saving navi nodes');
        // Held, then sent once more -- and the caller receives the repeat's answer, not the 403.
        expect(out.status).toBeUndefined();
        const repeat = httpMock.expectOne('/api/v1/navi/nodes/0192f0a1-1111-7000-8000-000000000001');
        expect(repeat.request.body).toEqual({ title: 'Home' });
        repeat.flush({ id: 'n1', title: 'Home' });
        expect(out.body).toEqual({ id: 'n1', title: 'Home' });
        expect(told).toEqual([]);
    });

    it('tells the notice, naming the action, and hands back the 403 when the person declines', () => {
        setup();
        grant = false;
        const out = outcomeOf(http.delete('/api/v1/vfs/nodes?path=/docs/a.md'));

        refuse('/api/v1/vfs/nodes?path=/docs/a.md');
        httpMock.expectOne(ELEVATION).flush(state(false));

        expect(opened.length).toBe(1);
        expect(told).toEqual([{ refusal: "Permission denied: cannot write '/docs/a.md'", action: 'Deleting vfs nodes' }]);
        expect(out.status).toBe(403);
        httpMock.expectNone('/api/v1/vfs/nodes?path=/docs/a.md');
    });

    it('sends the write again without asking when the session is elevated already', () => {
        setup();
        const out = outcomeOf(http.put('/api/v1/themes/site', { a: 1 }));

        refuse('/api/v1/themes/site', 'Access Denied.', 'identity.administrator_role');
        httpMock.expectOne(ELEVATION).flush(state(true));

        expect(opened).toEqual([]);
        httpMock.expectOne('/api/v1/themes/site').flush({ ok: true });
        expect(out.body).toEqual({ ok: true });
    });

    it('answers a second refusal of the repeat with the 403, never a second prompt', () => {
        setup();
        const out = outcomeOf(http.post('/api/v1/vfs/directories', { path: '/docs/new' }));

        refuse('/api/v1/vfs/directories');
        httpMock.expectOne(ELEVATION).flush(state(false));
        refuse('/api/v1/vfs/directories');

        expect(opened.length).toBe(1);
        expect(out.status).toBe(403);
        httpMock.expectNone(ELEVATION);
    });

    it('tells the notice at once when no prompt is bound', () => {
        setup({ prompt: false });
        const out = outcomeOf(http.delete('/api/v1/vfs/nodes?path=/docs/b.md'));

        refuse('/api/v1/vfs/nodes?path=/docs/b.md');

        expect(told.length).toBe(1);
        expect(out.status).toBe(403);
        httpMock.expectNone(ELEVATION);
    });

    it('does nothing for a 403 the server did not stamp, a stamp from another origin, or a wrong password', () => {
        setup();
        const plain = outcomeOf(http.post('/api/v1/vfs/directories', { path: '/docs/new' }));
        httpMock.expectOne('/api/v1/vfs/directories').flush({ detail: 'You may not.' }, { status: 403, statusText: 'Forbidden' });
        outcomeOf(http.post('https://elsewhere.example/api/v1/x', {}));
        refuse('https://elsewhere.example/api/v1/x');
        const bypass = { context: new HttpContext().set(BYPASS_ELEVATION, true) };
        outcomeOf(http.post('/api/v1/auth/elevation-grant', { password: 'x' }, bypass));
        refuse('/api/v1/auth/elevation-grant', 'Wrong password.');

        expect(plain.status).toBe(403);
        expect(opened).toEqual([]);
        expect(told).toEqual([]);
        httpMock.expectNone(ELEVATION);
    });

    it('names the action as the caller said it, or by the method and the resource', () => {
        const named = new HttpRequest('PATCH', '/api/v1/navi/nodes/1', {}, {
            context: new HttpContext().set(ELEVATION_ACTION, 'Saving the menu entry'),
        });

        expect(actionOf(named)).toBe('Saving the menu entry');
        expect(actionOf(new HttpRequest('POST', '/api/v1/font-families', {}))).toBe('Creating font families');
        expect(actionOf(new HttpRequest('DELETE', '/api/v1/vfs/nodes?path=/a'))).toBe('Deleting vfs nodes');
        expect(actionOf(new HttpRequest('PUT', '/api/v1', {}))).toBe('Saving');
    });
});

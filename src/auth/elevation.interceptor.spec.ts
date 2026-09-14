import { TestBed } from '@angular/core/testing';
import {
    HttpClient, HttpContext, type HttpInterceptorFn, provideHttpClient, withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { elevationInterceptor } from './elevation.interceptor';
import { BYPASS_ELEVATION, ElevationService } from './elevation.service';
import { ELEVATION_PROMPT, type ElevationPromptRequest } from './elevation-prompt.port';
import type { ElevationState } from './elevation.types';

/**
 * The elevation client requirement, point 1: the prompt hangs off the 403.
 *
 * Coverage:
 *   1. A 403 on a gated URL asks the state endpoint; unelevated -> the prompt
 *      opens with the server's refusal sentence; a grant -> the request is
 *      sent again and the caller sees the retry's answer.
 *   2. Declined -> the caller gets the ORIGINAL 403, and no retry is sent.
 *   3. Elevated already -> no prompt, the 403 is a real refusal.
 *   4. Not a 403 (404) -> untouched, no state read.
 *   5. Not a gated URL (/content/pages) -> untouched.
 *   6. The elevation endpoint's own 403 (wrong password) is not a refused
 *      action: BYPASS_ELEVATION passes it through.
 *   7. A burst of refusals opens ONE prompt; every caller retries on the one
 *      grant.
 *   8. No port bound -> a 403 stays a 403 (the kit works without a panel).
 */
describe('elevationInterceptor', () => {
    let http: HttpClient;
    let httpMock: HttpTestingController;
    let opened: ElevationPromptRequest[];
    let answer: Subject<boolean>;

    const ELEVATION = '/api/v1/auth/elevation';
    const manifest  = { apiBase: '/api/v1', identity: { elevationUrl: ELEVATION } };

    const unelevated: ElevationState = {
        elevated: false, ended: { reason: 'closed', at: '2026-09-14T11:32:00+03:00' },
        lifetimeSeconds: 900, lifetimeCeilingSeconds: 3600, mfaRequired: false, warnings: [],
    };
    const elevated: ElevationState = {
        ...unelevated, elevated: true, expiresAt: '2099-01-01T00:00:00+00:00', ended: { reason: 'never', at: null },
    };

    const setup = (withPort = true): void => {
        opened = [];
        answer = new Subject<boolean>();
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([elevationInterceptor as HttpInterceptorFn])),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => manifest } },
                ...(withPort ? [{
                    provide: ELEVATION_PROMPT,
                    useValue: { open: (r: ElevationPromptRequest) => { opened.push(r); return answer.asObservable(); } },
                }] : []),
            ],
        });
        http     = TestBed.inject(HttpClient);
        httpMock = TestBed.inject(HttpTestingController);
    };

    afterEach(() => httpMock.verify());

    const refuse = (url: string, detail = "Permission denied: cannot write '/docs/a.md'"): void => {
        httpMock.expectOne(url).flush({ detail }, { status: 403, statusText: 'Forbidden' });
    };

    it('opens the prompt on a 403 while unelevated, and retries the action on a grant', () => {
        setup();
        const results: unknown[] = [];
        http.delete('/api/v1/vfs/nodes?path=/docs/a.md').subscribe({ next: r => results.push(r), error: e => results.push(e) });

        refuse('/api/v1/vfs/nodes?path=/docs/a.md');
        httpMock.expectOne(ELEVATION).flush(unelevated);

        expect(opened.length).toBe(1);
        expect(opened[0].refusal).toBe("Permission denied: cannot write '/docs/a.md'");
        expect(opened[0].state.ended.reason).toBe('closed');
        expect(results.length).toBe(0);

        answer.next(true); answer.complete();
        httpMock.expectOne('/api/v1/vfs/nodes?path=/docs/a.md').flush({ ok: true });
        expect(results).toEqual([{ ok: true }]);
    });

    it('hands the ORIGINAL 403 back when the prompt is declined, and sends no retry', () => {
        setup();
        let error: unknown = null;
        http.post('/api/v1/vfs/directories', { path: '/docs/new' }).subscribe({ error: e => { error = e; } });

        refuse('/api/v1/vfs/directories', 'Permission denied: cannot create');
        httpMock.expectOne(ELEVATION).flush(unelevated);
        answer.next(false); answer.complete();

        expect((error as { status: number }).status).toBe(403);
        expect((error as { error: { detail: string } }).error.detail).toBe('Permission denied: cannot create');
        httpMock.expectNone('/api/v1/vfs/directories');
    });

    it('does not prompt when the server says the session is elevated already', () => {
        setup();
        let error: unknown = null;
        http.put('/api/v1/vfs/files/content?path=/x', 'body').subscribe({ error: e => { error = e; } });

        refuse('/api/v1/vfs/files/content?path=/x');
        httpMock.expectOne(ELEVATION).flush(elevated);

        expect(opened.length).toBe(0);
        expect((error as { status: number }).status).toBe(403);
    });

    it('leaves a non-403 alone and reads no state', () => {
        setup();
        let error: unknown = null;
        http.get('/api/v1/vfs/directories/list?path=/gone').subscribe({ error: e => { error = e; } });

        httpMock.expectOne('/api/v1/vfs/directories/list?path=/gone').flush({}, { status: 404, statusText: 'Not Found' });
        httpMock.expectNone(ELEVATION);
        expect(opened.length).toBe(0);
        expect((error as { status: number }).status).toBe(404);
    });

    it('leaves a 403 outside the gated URLs alone', () => {
        setup();
        let error: unknown = null;
        http.get('/api/v1/content/pages').subscribe({ error: e => { error = e; } });

        refuse('/api/v1/content/pages');
        httpMock.expectNone(ELEVATION);
        expect(opened.length).toBe(0);
        expect((error as { status: number }).status).toBe(403);
    });

    it('passes the elevation endpoint\'s own 403 (wrong password) through untouched', () => {
        setup();
        let error: unknown = null;
        const context = new HttpContext().set(BYPASS_ELEVATION, true);
        http.post(ELEVATION, { password: 'nope' }, { context }).subscribe({ error: e => { error = e; } });

        refuse(ELEVATION, 'Wrong password');
        expect(opened.length).toBe(0);
        expect((error as { status: number }).status).toBe(403);
    });

    it('opens ONE prompt for a burst of refusals and retries every one on the grant', () => {
        setup();
        const done: string[] = [];
        for (const p of ['/a', '/b', '/c']) {
            http.delete(`/api/v1/vfs/nodes?path=${p}`).subscribe({ next: () => done.push(p) });
        }
        for (const p of ['/a', '/b', '/c']) refuse(`/api/v1/vfs/nodes?path=${p}`);

        // Each refusal asks the state endpoint (the answer is what decides),
        // but the prompt is shared: one dialog, three callers waiting on it.
        httpMock.match(ELEVATION).forEach(r => r.flush(unelevated));
        expect(opened.length).toBe(1);

        answer.next(true); answer.complete();
        for (const p of ['/a', '/b', '/c']) httpMock.expectOne(`/api/v1/vfs/nodes?path=${p}`).flush({});
        expect(done).toEqual(['/a', '/b', '/c']);
    });

    it('with no port bound, a 403 stays a 403', () => {
        setup(false);
        let error: unknown = null;
        http.delete('/api/v1/vfs/nodes?path=/a').subscribe({ error: e => { error = e; } });

        refuse('/api/v1/vfs/nodes?path=/a');
        httpMock.expectNone(ELEVATION);
        expect((error as { status: number }).status).toBe(403);
        expect(TestBed.inject(ElevationService).elevated()).toBe(false);
    });
});

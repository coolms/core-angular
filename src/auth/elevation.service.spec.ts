import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { ElevationService } from './elevation.service';
import { ELEVATION_PROMPT } from './elevation-prompt.port';
import type { ElevationChange, ElevationState } from './elevation.types';

/**
 * The elevation client requirement, points 3 and 4: one source, and every
 * change of it announced.
 *
 * Coverage:
 *   1. A grant announces `granted`; a refresh that says the same announces
 *      nothing (no refetch for no reason).
 *   2. At `expiresAt` the service asks the SERVER (no local flip); the answer
 *      `expired` is announced as such.
 *   3. A drop sends DELETE ?reason= and announces `dropped` from the refresh
 *      that follows it.
 *   4. Another tab's write to the storage key makes this tab ask the server.
 *   5. Without the manifest URL the service is inert: no requests, no throw.
 *   6. A state read past `expiresAt` reports expired WITHOUT a request, and
 *      announces it once. This is the one that had never run in production:
 *      the only grant this installation has ever made was dropped at 2m58s of
 *      a 15-minute lifetime, so expiry had never fired, and a mechanism that
 *      has never executed is unknown rather than probably working.
 *   7. A tab coming back into view re-asks, once for the pair of events.
 *
 * Specs 6 and 7 deliberately do NOT use `fakeAsync`: with real timers, nothing
 * scheduled can fire inside a synchronous spec, so anything they observe was
 * done by the read rather than by the timer. The clock is moved instead of
 * waited on.
 */
describe('ElevationService', () => {
    let service: ElevationService;
    let httpMock: HttpTestingController;
    let changes: ElevationChange[];

    const ELEVATION = '/api/v1/auth/elevation';

    const base: ElevationState = {
        elevated: false, ended: { reason: 'never', at: null },
        lifetimeSeconds: 900, lifetimeCeilingSeconds: 3600, mfaRequired: false, warnings: [],
    };

    const setup = (manifest: unknown = { apiBase: '/api/v1', identity: { elevationUrl: ELEVATION } }): void => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => manifest } },
                { provide: ELEVATION_PROMPT, useValue: { open: () => of(true) } },
            ],
        });
        service  = TestBed.inject(ElevationService);
        httpMock = TestBed.inject(HttpTestingController);
        changes  = [];
        service.changes$.subscribe(c => changes.push(c));
    };

    afterEach(() => httpMock.verify());

    it('announces a grant once, and a same-state refresh not at all', () => {
        setup();
        const granted: ElevationState = { ...base, elevated: true, expiresAt: '2099-01-01T00:00:00Z', grantedAt: '2098-12-31T23:45:00Z' };

        service.elevate('secret').subscribe();
        const post = httpMock.expectOne(ELEVATION);
        expect(post.request.method).toBe('POST');
        expect(post.request.body).toEqual({ password: 'secret' });
        post.flush(granted);

        expect(service.elevated()).toBe(true);
        expect(changes.map(c => c.kind)).toEqual(['granted']);

        service.refresh().subscribe();
        httpMock.expectOne(ELEVATION).flush(granted);
        expect(changes.length).toBe(1);
    });

    it('sends the code only when given', () => {
        setup();
        service.elevate('secret', '123456').subscribe();
        const post = httpMock.expectOne(ELEVATION);
        expect(post.request.body).toEqual({ password: 'secret', code: '123456' });
        post.flush({ ...base, elevated: true, expiresAt: '2099-01-01T00:00:00Z', factorConfirmed: true });
        expect(service.state()?.factorConfirmed).toBe(true);
    });

    it('asks the server at expiresAt and announces what it answers', fakeAsync(() => {
        setup();
        const expiresAt = new Date(Date.now() + 5_000).toISOString();
        service.elevate('secret').subscribe();
        httpMock.expectOne(ELEVATION).flush({ ...base, elevated: true, expiresAt });

        tick(4_000);
        httpMock.expectNone(ELEVATION);
        expect(service.elevated()).toBe(true);

        tick(1_500);
        const read = httpMock.expectOne(ELEVATION);
        expect(read.request.method).toBe('GET');
        read.flush({ ...base, elevated: false, ended: { reason: 'expired', at: expiresAt } });

        expect(service.elevated()).toBe(false);
        expect(changes.map(c => c.kind)).toEqual(['granted', 'expired']);
    }));

    it('drops with a reason and announces the drop from the refresh that follows', () => {
        setup();
        service.elevate('secret').subscribe();
        httpMock.expectOne(ELEVATION).flush({ ...base, elevated: true, expiresAt: '2099-01-01T00:00:00Z' });

        service.drop('dropped_by_user').subscribe();
        const del = httpMock.expectOne(`${ELEVATION}?reason=dropped_by_user`);
        expect(del.request.method).toBe('DELETE');
        del.flush(null, { status: 204, statusText: 'No Content' });
        httpMock.expectOne(ELEVATION).flush({ ...base, ended: { reason: 'dropped_by_user', at: '2026-09-14T11:40:00Z' } });

        expect(service.elevated()).toBe(false);
        expect(changes.map(c => c.kind)).toEqual(['granted', 'dropped']);
    });

    it('asks the server when another tab announces a change', () => {
        setup();
        window.dispatchEvent(new StorageEvent('storage', { key: 'coolms.elevation.changed', newValue: '1' }));
        httpMock.expectOne(ELEVATION).flush(base);
        expect(changes.length).toBe(0);

        window.dispatchEvent(new StorageEvent('storage', { key: 'something.else', newValue: '1' }));
        httpMock.expectNone(ELEVATION);
    });

    it('is inert without the manifest URL', () => {
        setup({ apiBase: '/api/v1', identity: {} });
        expect(service.available).toBe(false);
        let state: ElevationState | null = null;
        service.refresh().subscribe(s => { state = s; });
        httpMock.expectNone(ELEVATION);
        expect(state!.elevated).toBe(false);
        expect(service.isGated('/api/v1/vfs/nodes')).toBe(true);
        expect(service.isGated('/api/v1/content/pages')).toBe(false);
    });

    /**
     * Seed a live grant of `seconds` and hand back the moment it ends. Uses a
     * real POST so the state arrives the way the server gives it.
     */
    const granted = (seconds: number): number => {
        const endsAt = Date.now() + seconds * 1_000;
        service.elevate('secret').subscribe();
        httpMock.expectOne(ELEVATION).flush({
            ...base, elevated: true, expiresAt: new Date(endsAt).toISOString(),
        });
        return endsAt;
    };

    /** Move the clock rather than wait for it. */
    const clockTo = (at: number): void => {
        spyOn(Date, 'now').and.returnValue(at);
    };

    it('reports expired on a read once expiresAt has gone by, and asks nothing to find out', () => {
        setup();
        const endsAt = granted(900);
        expect(service.elevated()).toBe(true);

        // One second past the moment the server named. No timer has run --
        // this spec has real timers and never yields -- and no request is made.
        clockTo(endsAt + 1_000);

        expect(service.elevated()).toBe(false);
        expect(service.expiresAt()).toBeNull();
        expect(service.state()!.ended).toEqual({ reason: 'expired', at: new Date(endsAt).toISOString() });
        httpMock.expectNone(ELEVATION);
    });

    it('does not expire an answer whose expiresAt it cannot read', () => {
        setup();
        service.elevate('secret').subscribe();
        httpMock.expectOne(ELEVATION).flush({ ...base, elevated: true, expiresAt: 'not a date' });

        // Garbage is a reason to keep asking the server, not to end an
        // elevation it may still be granting.
        expect(service.elevated()).toBe(true);
    });

    it('announces the expiry once, however many times it is read', async () => {
        setup();
        const endsAt = granted(900);
        clockTo(endsAt + 1_000);

        service.elevated();
        service.state();
        service.expiresAt();
        await Promise.resolve();

        expect(changes.map(c => c.kind)).toEqual(['granted', 'expired']);
        expect(changes[1].state.ended.reason).toBe('expired');
        httpMock.expectNone(ELEVATION);
    });

    it('re-asks when the tab comes back, once for the pair of events', () => {
        setup();
        service.refresh().subscribe();
        httpMock.expectOne(ELEVATION).flush(base);

        // visibilitychange and focus both fire on a single alt-tab.
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
        httpMock.expectOne(ELEVATION).flush(base);
        httpMock.expectNone(ELEVATION);

        // ...and a return later than the coalescing window does ask again.
        clockTo(Date.now() + 10_000);
        window.dispatchEvent(new Event('focus'));
        httpMock.expectOne(ELEVATION).flush(base);
    });

    it('ends an elapsed grant on the way back even when the server cannot be reached', () => {
        setup();
        const endsAt = granted(900);
        clockTo(endsAt + 1_000);

        window.dispatchEvent(new Event('focus'));
        httpMock.expectOne(ELEVATION).error(new ProgressEvent('offline'));

        // The read had already decided; the failed request changes nothing.
        expect(service.elevated()).toBe(false);
    });
});

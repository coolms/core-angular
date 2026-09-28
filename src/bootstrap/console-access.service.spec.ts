import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Actions, ActionStatus, Store } from '@ngxs/store';
import { firstValueFrom, of, Subject } from 'rxjs';
import { ConsoleAccessService } from './console-access.service';
import { Logout } from '../auth/auth.actions';
import { AppConfigState, SetAppConfig } from '../state/app-config.state';

/**
 * The console is granted by the server, per sign-in.
 *
 * Coverage:
 *   1. 200: `granted`, and the console's manifest is merged over the public one --
 *      what the sign-in page had stays, what the console needs arrives. Asked once.
 *   2. 403: `refused`, and kept: the guard does not ask again for this sign-in.
 *   3. 500: `unknown`, and NOT kept -- a failure to ask is not an answer.
 *   4. A Logout makes the next navigation ask again (another sign-in, another answer).
 *   5. An answer that arrives after a sign-out is kept for nobody: the one waiting on
 *      it is answered for the sign-in there is now (A's late 403 must not sign B out).
 *   6. Signing a refused account out ends the sign-in on the server, then here -- and
 *      here even when the server's answer is an error.
 */
describe('ConsoleAccessService', () => {
    let service: ConsoleAccessService;
    let httpMock: HttpTestingController;
    let dispatched: unknown[];
    let actions$: Subject<unknown>;

    const publicConfig = {
        slug: 'admin',
        manifest: { apiBase: '/api/v1', auth: { login: '/api/v1/auth/login', logout: '/api/v1/auth/logout' } },
    };

    beforeEach(() => {
        dispatched = [];
        actions$ = new Subject<unknown>();
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: (selector: unknown) =>
                            AppConfigState.manifest === selector ? publicConfig.manifest : publicConfig,
                        dispatch: (action: unknown) => { dispatched.push(action); return of(undefined); },
                    },
                },
                { provide: Actions, useValue: actions$ },
            ],
        });
        service  = TestBed.inject(ConsoleAccessService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it('merges the console manifest over the public one when granted, and asks once', async () => {
        const answer = service.ensure();
        httpMock.expectOne(ConsoleAccessService.URL)
            .flush({ manifest: { apiBase: '/api/v1', navi: { graph: '/api/v1/navi/trees/{slug}/graph' } } });

        expect(await answer).toBe('granted');
        const set = dispatched[0] as SetAppConfig;
        expect(set instanceof SetAppConfig).toBeTrue();
        expect(set.config.slug).toBe('admin');
        expect((set.config.manifest as unknown as Record<string, unknown>)['auth'])
            .toEqual({ login: '/api/v1/auth/login', logout: '/api/v1/auth/logout' });
        expect((set.config.manifest as unknown as Record<string, unknown>)['navi'])
            .toEqual({ graph: '/api/v1/navi/trees/{slug}/graph' });

        expect(await service.ensure()).toBe('granted');
        httpMock.expectNone(ConsoleAccessService.URL);
    });

    it('is refused on 403, and keeps the refusal for this sign-in', async () => {
        const answer = service.ensure();
        httpMock.expectOne(ConsoleAccessService.URL).flush({}, { status: 403, statusText: 'Forbidden' });

        expect(await answer).toBe('refused');
        expect(dispatched.length).toBe(0);
        expect(await service.ensure()).toBe('refused');
        httpMock.expectNone(ConsoleAccessService.URL);
    });

    it('does not keep a failure to ask', async () => {
        const first = service.ensure();
        httpMock.expectOne(ConsoleAccessService.URL).flush({}, { status: 500, statusText: 'Server Error' });
        expect(await first).toBe('unknown');

        const second = service.ensure();
        httpMock.expectOne(ConsoleAccessService.URL).flush({}, { status: 403, statusText: 'Forbidden' });
        expect(await second).toBe('refused');
    });

    it('asks again after a sign-out', async () => {
        const first = service.ensure();
        httpMock.expectOne(ConsoleAccessService.URL).flush({}, { status: 403, statusText: 'Forbidden' });
        expect(await first).toBe('refused');

        actions$.next({ action: new Logout(), status: ActionStatus.Dispatched });

        const second = service.ensure();
        httpMock.expectOne(ConsoleAccessService.URL).flush({ manifest: { apiBase: '/api/v1' } });
        expect(await second).toBe('granted');
    });

    it('keeps an answer that arrives after a sign-out for nobody, and asks for the sign-in there is now', async () => {
        const waiting = service.ensure();
        const late = httpMock.expectOne(ConsoleAccessService.URL);

        actions$.next({ action: new Logout(), status: ActionStatus.Dispatched });
        late.flush({}, { status: 403, statusText: 'Forbidden' });
        // Every microtask the late answer schedules runs before a macrotask does.
        await new Promise(resolve => setTimeout(resolve));

        httpMock.expectOne(ConsoleAccessService.URL).flush({ manifest: { apiBase: '/api/v1' } });
        expect(await waiting).toBe('granted');
        expect(await service.ensure()).toBe('granted');
        httpMock.expectNone(ConsoleAccessService.URL);
    });

    it('signs a refused account out on the server, then here', async () => {
        const done = firstValueFrom(service.signOut());
        const logout = httpMock.expectOne('/api/v1/auth/logout');
        expect(logout.request.method).toBe('POST');
        expect(dispatched.length).toBe(0);
        logout.flush(null);
        await done;
        expect(dispatched.length).toBe(1);
        expect(dispatched[0] instanceof Logout).toBeTrue();
    });

    it('signs out here even when the server refuses the sign-out', async () => {
        const done = firstValueFrom(service.signOut());
        httpMock.expectOne('/api/v1/auth/logout').flush({}, { status: 500, statusText: 'Server Error' });
        await done;
        expect(dispatched[0] instanceof Logout).toBeTrue();
    });
});

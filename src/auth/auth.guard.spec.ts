import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { Store } from '@ngxs/store';
import { firstValueFrom, isObservable, of, type Observable } from 'rxjs';
import { authGuard } from './auth.guard';
import { AppInitService } from '../bootstrap/app-init.service';
import { ConsoleAccessService, type ConsoleAccess } from '../bootstrap/console-access.service';

/**
 * The admin opens for an account the console is granted to, and for no other.
 *
 * Coverage:
 *   1. Not signed in: the login page, and the console is not asked.
 *   2. Granted: the route opens.
 *   3. Refused: this sign-in is signed out (the service ends it on the server), and the
 *      login page says why.
 *   4. Unknown (the question failed): the route opens -- the server still decides
 *      every request the console makes.
 */
describe('authGuard', () => {
    let dispatched: unknown[];
    let asked: number;
    let signedOut: number;

    const run = async (authenticated: boolean, access: ConsoleAccess): Promise<boolean | UrlTree> => {
        dispatched = [];
        asked = 0;
        signedOut = 0;
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                { provide: AppInitService, useValue: { ready$: of(undefined) } },
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: () => authenticated,
                        dispatch: (action: unknown) => { dispatched.push(action); return of(undefined); },
                    },
                },
                {
                    provide: ConsoleAccessService,
                    useValue: {
                        ensure: () => { asked++; return Promise.resolve(access); },
                        signOut: () => { signedOut++; return of(undefined); },
                    },
                },
            ],
        });
        const result = TestBed.runInInjectionContext(
            () => authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
        );
        return isObservable(result)
            ? firstValueFrom(result as Observable<boolean | UrlTree>)
            : (result as boolean | UrlTree);
    };

    const url = (result: boolean | UrlTree): string =>
        result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : String(result);

    it('sends an anonymous visitor to sign in without asking the console', async () => {
        expect(url(await run(false, 'granted'))).toBe('/login');
        expect(asked).toBe(0);
    });

    it('opens for an account the console is granted to', async () => {
        expect(await run(true, 'granted')).toBeTrue();
        expect(signedOut).toBe(0);
    });

    it('signs a refused account out and says why on the login page', async () => {
        expect(url(await run(true, 'refused'))).toBe('/login?reason=' + ConsoleAccessService.REFUSED_REASON);
        expect(signedOut).toBe(1);
        expect(dispatched.length).toBe(0);
    });

    it('opens when the question failed, and signs nobody out', async () => {
        expect(await run(true, 'unknown')).toBeTrue();
        expect(signedOut).toBe(0);
    });
});

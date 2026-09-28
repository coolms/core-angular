import { Component, NgZone, provideZoneChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type UrlTree } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, of } from 'rxjs';
import { LoginComponent } from './login.component';
import { ConsoleAccessService } from '../../bootstrap/console-access.service';

@Component({ standalone: true, template: 'the console' })
class ConsoleStub {}

/**
 * The sign-in page says why, when the console is refused.
 *
 * Measured in a browser on the served admin (2026-09-28): a refused account signed in,
 * the guard signed it out and redirected to /login?reason=no-console-access -- and the
 * page still said "Signing in..." with no message. This drives the same path: a
 * sign-in, a navigation to the console, a guard that sends it back with the reason.
 *
 * The cause was not the logic but the ZONE: the store answers a dispatch outside Angular's
 * zone, so the message was set and never rendered (the same held for a wrong password).
 * The last two specs answer outside the zone, as the store does, and record where the
 * message is set.
 */
describe('LoginComponent', () => {
    const refusedBack = (): UrlTree =>
        inject(Router).createUrlTree(['/login'], { queryParams: { reason: ConsoleAccessService.REFUSED_REASON } });

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                // The admin boots with zone change detection (main.ts); a TestBed without it is
                // zoneless, where nothing re-renders a plain field and the zone is not modelled.
                provideZoneChangeDetection(),
                provideRouter([
                    { path: 'login', component: LoginComponent },
                    { path: '', pathMatch: 'full', component: ConsoleStub, canActivate: [refusedBack] },
                ]),
                { provide: Store, useValue: { dispatch: () => of(undefined) } },
            ],
        });
    });

    it('says the account has no console access when the guard sends a sign-in back', async () => {
        const harness = await RouterTestingHarness.create('/login');
        const login = harness.routeDebugElement!.componentInstance as LoginComponent;
        login.identifier = 'customer@example.test';
        login.password = 'x';

        login.submit();
        await harness.fixture.whenStable();
        harness.detectChanges();

        expect(TestBed.inject(Router).url).toBe('/login?reason=' + ConsoleAccessService.REFUSED_REASON);
        expect(harness.routeDebugElement!.componentInstance).toBe(login);
        expect(login.loading).toBeFalse();
        expect(login.error).toBe(LoginComponent.NO_CONSOLE_ACCESS);
    });

    it('says so when the page is opened with the reason', async () => {
        const harness = await RouterTestingHarness.create('/login?reason=' + ConsoleAccessService.REFUSED_REASON);
        const login = harness.routeDebugElement!.componentInstance as LoginComponent;

        expect(login.error).toBe(LoginComponent.NO_CONSOLE_ACCESS);
    });

    /** A store that answers the sign-in outside Angular's zone, as the real one does. */
    const answeringOutsideTheZone = (fail: unknown | null) => ({
        dispatch: () => new Observable<void>(subscriber => {
            TestBed.inject(NgZone).runOutsideAngular(() => setTimeout(() => {
                if (null === fail) {
                    subscriber.next();
                    subscriber.complete();
                } else {
                    subscriber.error(fail);
                }
            }));
        }),
    });

    /**
     * Sign in against that store and record whether the message was set INSIDE the zone:
     * zone change detection re-renders only what changes there. (Reading the harness's DOM
     * could not tell: it re-rendered neither the fixed nor the broken component.)
     */
    const messageSetInsideTheZone = async (fail: unknown | null): Promise<{ inZone: boolean[]; error: string | null }> => {
        TestBed.overrideProvider(Store, { useValue: answeringOutsideTheZone(fail) });
        const harness = await RouterTestingHarness.create('/login');
        const login = harness.routeDebugElement!.componentInstance as LoginComponent;
        const inZone: boolean[] = [];
        let error: string | null = login.error;
        Object.defineProperty(login, 'error', {
            get: () => error,
            set: (value: string | null) => { error = value; if (null !== value) inZone.push(NgZone.isInAngularZone()); },
        });
        login.identifier = 'someone@example.test';
        login.password = 'x';
        login.submit();
        await new Promise(resolve => setTimeout(resolve, 50));
        await harness.fixture.whenStable();
        return { inZone, error };
    };

    it('sets the refusal inside the zone, though the store answers outside it', async () => {
        const { inZone, error } = await messageSetInsideTheZone(null);
        expect(error).toBe(LoginComponent.NO_CONSOLE_ACCESS);
        expect(inZone).toEqual([true]);
    });

    it('sets a wrong password inside the zone, though the store answers outside it', async () => {
        const { inZone, error } = await messageSetInsideTheZone({ error: { detail: 'Invalid credentials.' } });
        expect(error).toBe('Invalid credentials.');
        expect(inZone).toEqual([true]);
    });
});

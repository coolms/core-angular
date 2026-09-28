import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type UrlTree } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { LoginComponent } from './login.component';
import { ConsoleAccessService } from '../../bootstrap/console-access.service';

@Component({ standalone: true, template: 'the console' })
class ConsoleStub {}

/**
 * The sign-in page shows its answer when it arrives, not when the person next types.
 *
 * Measured in a browser on the served admin (2026-09-28): after a wrong password, and after
 * a sign-in the console refused (the guard signs it out and sends it back with
 * ?reason=no-console-access), the page kept saying "Signing in..." until a character was
 * typed. Angular 22 renders a component that names no strategy as OnPush, and the answer
 * arrived as a plain field: set, never drawn. The zone was blamed first and was not it.
 *
 * These specs do what the person does -- type, submit the form -- and read the PAGE after
 * the store's asynchronous answer, so they hold whatever the component keeps its state in.
 * "Signing in..." appearing on submit is the control: this instrument does see a change an
 * event makes, so a missing answer is the component's, not the harness's.
 */
describe('LoginComponent', () => {
    const refusedBack = (): UrlTree =>
        inject(Router).createUrlTree(['/login'], { queryParams: { reason: ConsoleAccessService.REFUSED_REASON } });

    /** A store that answers the sign-in later, as the real one does (over HTTP). */
    const answering = (fail: unknown | null) => ({
        dispatch: () => new Observable<void>(subscriber => {
            setTimeout(() => {
                if (null === fail) {
                    subscriber.next();
                    subscriber.complete();
                } else {
                    subscriber.error(fail);
                }
            });
        }),
    });

    const configure = (fail: unknown | null): void => {
        TestBed.configureTestingModule({
            providers: [
                provideRouter([
                    { path: 'login', component: LoginComponent },
                    { path: '', pathMatch: 'full', component: ConsoleStub, canActivate: [refusedBack] },
                ]),
                { provide: Store, useValue: answering(fail) },
            ],
        });
    };

    const text = (harness: RouterTestingHarness): string =>
        (harness.routeNativeElement?.textContent ?? '').replace(/\s+/g, ' ');

    /** Type and submit as a person does; the page right after submitting, and once the answer is in. */
    const signIn = async (fail: unknown | null): Promise<{ submitted: string; answered: string }> => {
        configure(fail);
        const harness = await RouterTestingHarness.create('/login');
        await harness.fixture.whenStable();
        const page = harness.routeNativeElement!;
        for (const [name, value] of [['identifier', 'someone@example.test'], ['password', 'x']]) {
            const input = page.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
            input.value = value;
            input.dispatchEvent(new Event('input'));
        }
        harness.detectChanges();
        page.querySelector('form')!.dispatchEvent(new Event('submit'));
        harness.detectChanges();
        const submitted = text(harness);

        await new Promise(resolve => setTimeout(resolve, 50));
        await harness.fixture.whenStable();
        harness.detectChanges();

        return { submitted, answered: text(harness) };
    };

    it('shows the console\'s refusal the guard sends back, without waiting for the person to type', async () => {
        const { submitted, answered } = await signIn(null);
        expect(submitted).toContain('Signing in');
        expect(TestBed.inject(Router).url).toBe('/login?reason=' + ConsoleAccessService.REFUSED_REASON);
        expect(answered).toContain(LoginComponent.NO_CONSOLE_ACCESS);
        expect(answered).not.toContain('Signing in');
    });

    it('shows a wrong password, without waiting for the person to type', async () => {
        const { submitted, answered } = await signIn({ error: { detail: 'Invalid credentials.' } });
        expect(submitted).toContain('Signing in');
        expect(answered).toContain('Invalid credentials.');
        expect(answered).not.toContain('Signing in');
    });

    it('says so when the page is opened with the reason', async () => {
        configure(null);
        const harness = await RouterTestingHarness.create('/login?reason=' + ConsoleAccessService.REFUSED_REASON);
        harness.detectChanges();

        expect(text(harness)).toContain(LoginComponent.NO_CONSOLE_ACCESS);
    });
});

import { audienceRefusalOf } from '../audience-refusal';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { Login } from '../auth.actions';
import { ConsoleAccessService } from '../../bootstrap/console-access.service';

@Component({
    selector: 'coolms-admin-login',
    standalone: true,
    imports: [FormsModule, NgIf],
    templateUrl: './login.component.html',
})
export class LoginComponent {
    identifier = '';
    readonly accountReady = LoginComponent.ACCOUNT_READY;
    password = '';

    // !! SIGNALS, not fields. Angular 22 renders a component that names no change-detection
    // strategy as OnPush (`onPush: changeDetection !== ChangeDetectionStrategy.Eager`), and
    // this one names none. So a plain field set from an asynchronous answer -- a wrong
    // password, or the console's refusal the guard sends back -- was set and never drawn: the
    // page said "Signing in..." until the person typed a character, which marked the view dirty
    // (measured in a browser on the served admin). A signal marks it dirty itself. Running the
    // answers inside the zone changes nothing: it re-runs change detection, which skips this
    // clean view.
    readonly loading = signal(false);
    readonly error   = signal<string | null>(null);
    /** The page was opened after an invitation was accepted (`ready=1`). */
    readonly ready   = signal(false);

    private readonly store  = inject(Store);
    private readonly router = inject(Router);

    /** Shown when the guard signed an account out because the console is not granted to it. */
    static readonly NO_CONSOLE_ACCESS = 'This account may not enter the admin.';

    /** Shown when a sign-in from before audiences was ended: it names no interface, and a new one will. */
    static readonly SIGN_IN_AGAIN = 'Please sign in again.';

    /** Shown when the page is opened with `ready=1`, after an invitation was accepted. */
    static readonly ACCOUNT_READY = 'Your account is ready; sign in with your new password.';

    constructor() {
        // Observed, not read once: after a sign-in the guard's redirect lands on this same
        // page, and the component is reused rather than made again.
        inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
            this.ready.set(params.get('ready') === '1');
            const reason = params.get('reason');
            if (ConsoleAccessService.REFUSED_REASON === reason) {
                this.loading.set(false);
                this.error.set(LoginComponent.NO_CONSOLE_ACCESS);
            } else if (ConsoleAccessService.SIGN_IN_AGAIN_REASON === reason) {
                this.loading.set(false);
                this.error.set(LoginComponent.SIGN_IN_AGAIN);
            }
        });
    }

    submit(): void {
        if (!this.identifier || !this.password) return;

        this.loading.set(true);
        this.error.set(null);

        this.store.dispatch(new Login(this.identifier, this.password)).subscribe({
            next: () => {
                // A rejected navigation used to vanish: nothing resets `loading`
                // on the success path, because the page is expected to go
                // away. If it does not, the form spins for ever with no reason
                // given, so say so instead.
                void this.router.navigate(['/']).catch(() => {
                    this.loading.set(false);
                    this.error.set('Signed in, but the admin could not be opened. Please reload.');
                });
            },
            error: (err) => {
                this.loading.set(false);
                // A refusal of entry is an answer, not a fault: said as this interface says it, whatever its detail.
                if ('not-granted' === audienceRefusalOf(err)) {
                    this.error.set(LoginComponent.NO_CONSOLE_ACCESS);
                    return;
                }
                this.error.set(err?.error?.detail ?? err?.error?.message ?? err?.message ?? 'Invalid credentials. Please try again.');
            },
        });
    }
}

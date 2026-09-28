import { Component, NgZone, inject } from '@angular/core';
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
    password = '';
    loading = false;
    error: string | null = null;

    private readonly store  = inject(Store);
    private readonly router = inject(Router);
    private readonly zone   = inject(NgZone);

    /** Shown when the guard signed an account out because the console is not granted to it. */
    static readonly NO_CONSOLE_ACCESS = 'This account has no access to the console.';

    constructor() {
        // Observed, not read once: after a sign-in the guard's redirect lands on this same
        // page, and the component is reused rather than made again.
        inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
            if (ConsoleAccessService.REFUSED_REASON === params.get('reason')) {
                this.loading = false;
                this.error   = LoginComponent.NO_CONSOLE_ACCESS;
            }
        });
    }

    submit(): void {
        if (!this.identifier || !this.password) return;

        this.loading = true;
        this.error = null;

        // !! The store answers a dispatch OUTSIDE Angular's zone. Measured in a browser on the
        // served admin (2026-09-28): after a wrong password, and after a sign-in the console
        // refused, the page kept saying "Signing in..." -- the message was set and never
        // rendered -- until the person typed a character. So both answers, and the navigation
        // the first one starts, run back inside the zone.
        this.store.dispatch(new Login(this.identifier, this.password)).subscribe({
            next: () => this.zone.run(() => {
                // A rejected navigation used to vanish: nothing resets `loading`
                // on the success path, because the page is expected to go
                // away. If it does not, the form spins for ever with no reason
                // given, so say so instead.
                void this.router.navigate(['/']).catch(() => {
                    this.loading = false;
                    this.error = 'Signed in, but the admin could not be opened. Please reload.';
                });
            }),
            error: (err) => this.zone.run(() => {
                this.loading = false;
                this.error = err?.error?.detail ?? err?.error?.message ?? err?.message ?? 'Invalid credentials. Please try again.';
            }),
        });
    }
}

import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { Login } from '../auth.actions';

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

    submit(): void {
        if (!this.identifier || !this.password) return;

        this.loading = true;
        this.error = null;

        this.store.dispatch(new Login(this.identifier, this.password)).subscribe({
            next: () => {
                // A rejected navigation used to vanish: nothing resets `loading`
                // on the success path, because the page is expected to go
                // away. If it does not, the form spins for ever with no reason
                // given, so say so instead.
                void this.router.navigate(['/']).catch(() => {
                    this.loading = false;
                    this.error = 'Signed in, but the admin could not be opened. Please reload.';
                });
            },
            error: (err) => {
                this.loading = false;
                this.error = err?.error?.detail ?? err?.error?.message ?? err?.message ?? 'Invalid credentials. Please try again.';
            },
        });
    }
}

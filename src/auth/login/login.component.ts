import { Component } from '@angular/core';
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

    constructor(private store: Store, private router: Router) {}

    submit(): void {
        if (!this.identifier || !this.password) return;

        this.loading = true;
        this.error = null;

        this.store.dispatch(new Login(this.identifier, this.password)).subscribe({
            next: () => {
                this.router.navigate(['/']);
            },
            error: (err) => {
                this.loading = false;
                this.error = err?.error?.detail ?? err?.error?.message ?? err?.message ?? 'Invalid credentials. Please try again.';
            },
        });
    }
}

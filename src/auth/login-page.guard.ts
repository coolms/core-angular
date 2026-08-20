import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';
import { Store } from '@ngxs/store';
import { AuthState } from './auth.state';
import { AppInitService } from '../bootstrap/app-init.service';

/**
 * Guards the `/login` route -- redirects already-authenticated
 * callers to admin home so a stale tab parked on `/login` cannot
 * remain mounted while another tab is logged in. When Tab A logs
 * in fresh, Tab B's `RestoreSession` (driven by APP_INITIALIZER)
 * reads the new token from shared `localStorage` and populates
 * `AuthState`; this guard then sees `isAuthenticated === true`
 * and routes Tab B to `/`.
 *
 * Same `ready$` wait as `authGuard` -- ensures `RestoreSession`
 * has run before the snapshot is read; otherwise a fresh F5 on
 * `/login` with a valid stored session would briefly evaluate
 * as anonymous, allow `/login`, and only then have the token
 * populated.
 */
export const loginPageGuard: CanActivateFn = () => {
    const init = inject(AppInitService);
    const store = inject(Store);
    const router = inject(Router);

    return init.ready$.pipe(
        take(1),
        map(() => {
            if (store.selectSnapshot(AuthState.isAuthenticated)) {
                return router.createUrlTree(['/']);
            }
            return true;
        }),
    );
};

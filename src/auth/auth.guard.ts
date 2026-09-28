import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { from, map, of, switchMap, take } from 'rxjs';
import { Store } from '@ngxs/store';
import { AuthState } from './auth.state';
import { AppInitService } from '../bootstrap/app-init.service';
import { ConsoleAccessService } from '../bootstrap/console-access.service';
import { Logout } from './auth.actions';

/**
 * Protects routes that require authentication.
 *
 * The guard is intentionally ASYNC: it waits for AppInitService.ready$ before
 * evaluating auth state.  Without this, Angular's router can evaluate
 * isAuthenticated while APP_INITIALIZER is still in-flight -- RestoreSession
 * will have placed a non-null (but expired) token in state, causing the guard
 * to pass even though the subsequent config/refresh requests will fail and
 * dispatch Logout.  Waiting for ready$ guarantees the auth state is settled.
 *
 * Signed in is not enough: the console is granted, and the server says to whom
 * (ConsoleAccessService). An account it refuses -- a customer who registered on the
 * public site -- is signed out of this sign-in and sent to the login page, which says
 * why. A failure to ask is not a refusal: the console opens, and every request it
 * makes is still decided by the server.
 */
export const authGuard: CanActivateFn = () => {
    const init    = inject(AppInitService);
    const store   = inject(Store);
    const router  = inject(Router);
    const consoleAccess = inject(ConsoleAccessService);

    return init.ready$.pipe(
        take(1),
        switchMap(() => {
            if (!store.selectSnapshot(AuthState.isAuthenticated)) {
                return of(router.createUrlTree(['/login']));
            }
            return from(consoleAccess.ensure()).pipe(
                switchMap(access => 'refused' !== access
                    ? of(true)
                    : store.dispatch(new Logout()).pipe(
                        map(() => router.createUrlTree(
                            ['/login'],
                            { queryParams: { reason: ConsoleAccessService.REFUSED_REASON } },
                        )),
                    )),
            );
        }),
    );
};

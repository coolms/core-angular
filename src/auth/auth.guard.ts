import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';
import { Store } from '@ngxs/store';
import { AuthState } from './auth.state';
import { AppInitService } from '../bootstrap/app-init.service';

/**
 * Protects routes that require authentication.
 *
 * The guard is intentionally ASYNC: it waits for AppInitService.ready$ before
 * evaluating auth state.  Without this, Angular's router can evaluate
 * isAuthenticated while APP_INITIALIZER is still in-flight — RestoreSession
 * will have placed a non-null (but expired) token in state, causing the guard
 * to pass even though the subsequent config/refresh requests will fail and
 * dispatch Logout.  Waiting for ready$ guarantees the auth state is settled.
 */
export const authGuard: CanActivateFn = () => {
    const init   = inject(AppInitService);
    const store  = inject(Store);
    const router = inject(Router);

    return init.ready$.pipe(
        take(1),
        map(() => {
            if (store.selectSnapshot(AuthState.isAuthenticated)) {
                return true;
            }
            return router.createUrlTree(['/login']);
        }),
    );
};

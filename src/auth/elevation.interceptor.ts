import { inject } from '@angular/core';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';
import { BYPASS_ELEVATION, ElevationService } from './elevation.service';
import { ErrorHandlerService } from '../errors/error-handler.service';

/**
 * The elevation prompt hangs off the 403, not off the listing's flags
 * (the elevation client requirement, point 1).
 *
 * Eight VFS actions -- rename, delete, move, copy, chmod, chown, upload, new --
 * carry no capability flag: they are offered unconditionally and refused by the
 * server. A prompt driven by the flags would never see them. So the prompt is
 * opened here, on the refusal itself: a 403 on a gated URL asks the server
 * whether this session is elevated, and only when it is NOT does the prompt
 * open; on a grant the refused request is sent again, once. A 403 while
 * elevated, a declined prompt, and an installation that cannot elevate all
 * hand the original error back to the caller, which renders it as it did
 * before -- nothing here swallows a refusal.
 *
 * Order in the chain: BEFORE the auth interceptor, so the retry re-enters it
 * and carries the token current at that moment (the prompt may have outlived
 * a refresh). The elevation endpoint's own calls carry BYPASS_ELEVATION: a
 * wrong password is a 403 and is not a refused action.
 */
export const elevationInterceptor: HttpInterceptorFn = (req, next) => {
    const elevation = inject(ElevationService);
    const errors    = inject(ErrorHandlerService);

    if (req.context.get(BYPASS_ELEVATION) || !elevation.isGated(req.url)) {
        return next(req);
    }

    return next(req).pipe(
        catchError((err: unknown) => {
            if (!(err instanceof HttpErrorResponse) || err.status !== 403) {
                return throwError(() => err);
            }

            return elevation.offerFor(errors.humanize(err)).pipe(
                switchMap(granted => granted ? next(req) : throwError(() => err)),
            );
        }),
    );
};

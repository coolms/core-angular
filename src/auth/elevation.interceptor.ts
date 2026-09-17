import { inject } from '@angular/core';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';
import { BYPASS_ELEVATION, ELEVATION_REQUIRED_HEADER, ElevationService } from './elevation.service';
import { ErrorHandlerService } from '../errors/error-handler.service';

/**
 * The elevation prompt hangs off the 403, not off the listing's flags
 * (the elevation client requirement, point 1) -- and off the 403 that SAYS it
 * was refused for want of elevation: the server stamps `X-Elevation-Required`
 * with the gate's name where its gate refused a member who has not elevated.
 * Any route of this API can carry it -- the VFS, a media asset's
 * permissions, a document template, an account's deletion -- so nothing here
 * lists URLs; the list that stood here lagged the server by every route whose
 * refusal came from the VFS permission service under another module's path.
 *
 * On the stamp: ask the server whether this session is elevated, and only when
 * it is NOT open the prompt; on a grant send the refused request again, once.
 * A 403 without the stamp is a refusal for another reason and is handed back
 * as it came; so are a 403 while elevated, a declined prompt, and an
 * installation that cannot elevate -- nothing here swallows a refusal. A
 * stamped 403 from anywhere but this API is ignored: the header is the
 * server's word, and only this server's counts.
 *
 * Order in the chain: BEFORE the auth interceptor, so the retry re-enters it
 * and carries the token current at that moment (the prompt may have outlived
 * a refresh). The elevation endpoint's own calls carry BYPASS_ELEVATION: a
 * wrong password is a 403 and is not a refused action.
 */
export const elevationInterceptor: HttpInterceptorFn = (req, next) => {
    const elevation = inject(ElevationService);
    const errors    = inject(ErrorHandlerService);

    if (req.context.get(BYPASS_ELEVATION) || !elevation.isThisApi(req.url)) {
        return next(req);
    }

    return next(req).pipe(
        catchError((err: unknown) => {
            if (!(err instanceof HttpErrorResponse) || err.status !== 403 || !err.headers.get(ELEVATION_REQUIRED_HEADER)) {
                return throwError(() => err);
            }

            return elevation.offerFor(errors.humanize(err)).pipe(
                switchMap(granted => granted ? next(req) : throwError(() => err)),
            );
        }),
    );
};

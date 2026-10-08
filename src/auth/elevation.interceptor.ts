import { inject } from '@angular/core';
import { type HttpInterceptorFn } from '@angular/common/http';
import { tap } from 'rxjs';
import { ELEVATION_NOTICE } from './elevation-prompt.port';
import { BACKGROUND_REQUEST, BYPASS_ELEVATION, ElevationService, isElevationRefusal } from './elevation.service';
import { ErrorHandlerService } from '../errors/error-handler.service';

/** Methods that read. A read is made by a page as it loads or by a poll, never as an action. */
const READS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A refusal for want of elevation is a 403 the server stamps `X-Elevation-Required`
 * where its gate refused a member who has not elevated ({@link isElevationRefusal}).
 * This interceptor never opens the elevation prompt. The prompt opens only when a
 * person asks for it: an Elevate button, or an action whose control already knows it
 * needs elevation and offers it ({@link ElevationService.offerFor}).
 *
 * What it does with a stamped 403:
 * - On a write a person made (POST, PUT, PATCH, DELETE without
 *   {@link BACKGROUND_REQUEST}): tells {@link ELEVATION_NOTICE}, which shows the
 *   refusal with an Elevate button. The request is not held and not repeated; the
 *   caller receives the 403 at once, and after elevating the person repeats the action.
 * - On a read: nothing. Reads are what a page makes as it loads and what polls make in
 *   the background, and the page shows its own state for a refused one -- an inline
 *   "needs an elevated session" with an Elevate button, or the feature hidden.
 * - On a background request: nothing. Nobody is waiting on it.
 *
 * Until 2026-10-08 any stamped 403 opened the prompt, so the setup reads of almost every
 * console page, and a realtime token at every load, opened it for an administrator who
 * had not elevated: 13 of 15 pages on a menu click, 15 of 15 on a reload (measured).
 *
 * The elevation endpoint's own calls carry {@link BYPASS_ELEVATION}: a wrong password is a
 * 403 and is not a refused action. A stamped 403 from anywhere but this API is ignored:
 * the header is the server's word, and only this server's counts.
 */
export const elevationInterceptor: HttpInterceptorFn = (req, next) => {
    const elevation = inject(ElevationService);

    if (req.context.get(BYPASS_ELEVATION)
        || req.context.get(BACKGROUND_REQUEST)
        || READS.has(req.method.toUpperCase())
        || !elevation.isThisApi(req.url)) {
        return next(req);
    }

    const notice = inject(ELEVATION_NOTICE, { optional: true });
    if (!notice) {
        return next(req);
    }
    const errors = inject(ErrorHandlerService);

    return next(req).pipe(
        tap({
            error: (err: unknown) => {
                if (isElevationRefusal(err)) {
                    notice.refused(errors.humanize(err));
                }
            },
        }),
    );
};

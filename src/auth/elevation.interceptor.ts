import { inject } from '@angular/core';
import { type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { catchError, of, switchMap, throwError } from 'rxjs';
import { ELEVATION_ACTION, ELEVATION_NOTICE } from './elevation-prompt.port';
import { BACKGROUND_REQUEST, BYPASS_ELEVATION, ElevationService, isElevationRefusal } from './elevation.service';
import { ErrorHandlerService } from '../errors/error-handler.service';

/** Methods that read. A read is made by a page as it loads or by a poll, never as an action. */
const READS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A refusal for want of elevation is a 403 the server stamps `X-Elevation-Required`
 * where its gate refused a member who has not elevated ({@link isElevationRefusal}).
 *
 * What it does with a stamped 403 (decided 2026-10-20 for a person's write):
 * - On a write a person made (POST, PUT, PATCH, DELETE without {@link BACKGROUND_REQUEST}):
 *   the prompt opens THERE, above whatever the person is in -- an edit dialog stays open
 *   beneath it with its input -- and the request is HELD. If the person elevates, it is
 *   sent once more and the caller receives that answer, as if the first had been accepted;
 *   if the session turns out to be elevated already (another tab), it is sent once more
 *   without asking. If the person declines, {@link ELEVATION_NOTICE} is told -- "Elevation
 *   required", naming the action, with an Elevate button -- and the caller receives the 403.
 *   The repeat is sent past this interceptor, so a second refusal is a 403, never a second
 *   prompt.
 * - On a read: nothing. Reads are what a page makes as it loads and what polls make in
 *   the background, and the page shows its own state for a refused one -- an inline
 *   "needs an elevated session" with an Elevate button, or the feature hidden.
 * - On a background request: nothing. Nobody is waiting on it.
 *
 * !! Why reads and background requests still open nothing. Until 2026-10-08 any stamped 403
 * opened the prompt, so the setup reads of almost every console page, and a realtime token at
 * every load, opened it for an administrator who had not elevated: 13 of 15 pages on a menu
 * click, 15 of 15 on a reload (measured). From then until 2026-10-20 a person's write opened
 * nothing either, only a toast -- which, with a dialog open, rendered under it, so the edit had
 * to be thrown away to elevate (measured on the served admin, Edit Node). A person's write is
 * the one refusal somebody is waiting on, which is why it is the one that asks.
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
    const errors = inject(ErrorHandlerService);

    return next(req).pipe(
        catchError((err: unknown) => {
            if (!isElevationRefusal(err)) {
                return throwError(() => err);
            }
            const refusal = errors.humanize(err);
            const action  = actionOf(req, elevation.apiBase);
            const decline = () => {
                notice?.refused(refusal, action);
                return throwError(() => err);
            };
            if (!elevation.canPrompt) {
                return decline();
            }

            return elevation.refresh().pipe(
                switchMap(state => state.elevated ? of(true) : elevation.requestElevation({ state, refusal, action })),
                catchError(() => of(false)),
                switchMap(granted => granted ? next(req) : decline()),
            );
        }),
    );
};

/**
 * The action a refused write was, in words for the person: what its caller said it is
 * ({@link ELEVATION_ACTION}), or else the method's verb and the resource the URL names --
 * "Saving navi nodes" for `PATCH /api/v1/navi/nodes/{id}`. Identifiers and the API base
 * are left out; they say nothing to the person who pressed the button.
 */
export function actionOf(req: HttpRequest<unknown>, apiBase = '/api/v1'): string {
    const named = req.context.get(ELEVATION_ACTION);
    if (named) {
        return named;
    }
    const verb = ({ POST: 'Creating', PUT: 'Saving', PATCH: 'Saving', DELETE: 'Deleting' } as Record<string, string>)[
        req.method.toUpperCase()
    ] ?? 'This change';
    let path = req.url.split('?')[0];
    try {
        path = new URL(path, 'http://x').pathname;
    } catch {
        // A relative URL that will not parse is used as written.
    }
    if (path.startsWith(apiBase)) {
        path = path.slice(apiBase.length);
    }
    const words = path.split('/')
        .filter(s => s !== '' && !/^[0-9a-f-]{8,}$/i.test(s) && !/^\d+$/.test(s))
        .map(s => s.replace(/[-_]/g, ' '));

    return words.length === 0 ? verb : `${verb} ${words.join(' ')}`;
}

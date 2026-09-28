import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Actions, ofActionDispatched, Store } from '@ngxs/store';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { Login, Logout, RestoreSession } from '../auth/auth.actions';
import { AppConfigState, SetAppConfig } from '../state/app-config.state';
import { type ConsoleManifestResponse } from '../api/api-manifest.types';

/** What the server said about this sign-in and the console. */
export type ConsoleAccess = 'granted' | 'refused' | 'unknown';

/**
 * Whether the signed-in account may use the console, and the console's endpoint
 * map when it may.
 *
 * The server decides: `GET /api/v1/console/manifest` answers the map to an account
 * that can read that resource's node (group `console` today) and 403 to anyone else
 * -- a customer who registered on the public site included. The public theme config
 * read before sign-in carries only what the sign-in page needs; the rest arrives
 * here, once per sign-in, and is merged into the app config.
 *
 * `unknown` is a failure to ask (the network, a 5xx), not an answer: it is not kept,
 * so the next navigation asks again.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleAccessService {
    /** The console manifest's URL: fixed, like the theme config's, because nothing is known before it. */
    static readonly URL = '/api/v1/console/manifest';

    /** The login page's query parameter value for "signed out: no console access". */
    static readonly REFUSED_REASON = 'no-console-access';

    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private answer: ConsoleAccess = 'unknown';
    private pending: Promise<ConsoleAccess> | null = null;

    constructor() {
        // Another sign-in -- or none -- is another question.
        inject(Actions).pipe(ofActionDispatched(Login, Logout, RestoreSession)).subscribe(() => {
            this.answer  = 'unknown';
            this.pending = null;
        });
    }

    /** Ask once per sign-in; the manifest is merged into the app config when granted. */
    ensure(): Promise<ConsoleAccess> {
        if ('unknown' !== this.answer) {
            return Promise.resolve(this.answer);
        }
        this.pending ??= firstValueFrom(
            this.http.get<ConsoleManifestResponse>(ConsoleAccessService.URL).pipe(
                map((response): ConsoleAccess => {
                    this.merge(response);
                    return 'granted';
                }),
                catchError((error: unknown) => of<ConsoleAccess>(
                    error instanceof HttpErrorResponse && 403 === error.status ? 'refused' : 'unknown',
                )),
            ),
        ).then(access => {
            this.answer  = access;
            this.pending = null;
            return access;
        });

        return this.pending;
    }

    private merge(response: ConsoleManifestResponse): void {
        const config = this.store.selectSnapshot(AppConfigState.config);
        this.store.dispatch(new SetAppConfig({
            ...(config ?? {}),
            manifest: { ...(config?.manifest ?? {}), ...response.manifest },
        }));
    }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Actions, ofActionDispatched, Store } from '@ngxs/store';
import { catchError, firstValueFrom, map, type Observable, of, switchMap } from 'rxjs';
import { Login, Logout, RestoreSession } from '../auth/auth.actions';
import { AppConfigState, SetAppConfig } from '../state/app-config.state';
import { type ConsoleManifestResponse } from '../api/api-manifest.types';

/** What the server said about this sign-in and the console. */
export type ConsoleAccess = 'granted' | 'refused' | 'unknown';

interface Asked {
    readonly access: ConsoleAccess;
    readonly response: ConsoleManifestResponse | null;
}

/**
 * Whether the signed-in account may use the console, and the console's endpoint
 * map when it may.
 *
 * The server decides: `GET /api/v1/console/manifest` answers the map to an account
 * that can read that resource's node (group `console` today) and 403 to anyone else
 * -- a customer who registered on the public site included. The public theme config
 * read before sign-in carries only what the sign-in page needs; the rest arrives
 * here, once per sign-in, and is merged into the app config key by key: a key the
 * console's map carries replaces the public one whole, so the console's copy of a
 * section is always the complete one.
 *
 * `unknown` is a failure to ask (the network, a 5xx), not an answer: it is not kept,
 * so while the endpoint fails every navigation asks again.
 *
 * !! An answer belongs to the sign-in it was asked for. A sign-in, a sign-out or a
 * restored session starts a new generation; an answer that arrives for a generation
 * that is gone is kept for nobody -- A's late 403 must not sign B out -- and whoever
 * is waiting on it is answered for the sign-in there is now.
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
    private generation = 0;

    constructor() {
        // Another sign-in -- or none -- is another question.
        inject(Actions).pipe(ofActionDispatched(Login, Logout, RestoreSession)).subscribe(() => {
            this.generation++;
            this.answer  = 'unknown';
            this.pending = null;
        });
    }

    /** Ask once per sign-in; the manifest is merged into the app config when granted. */
    ensure(): Promise<ConsoleAccess> {
        if ('unknown' !== this.answer) {
            return Promise.resolve(this.answer);
        }
        if (null !== this.pending) {
            return this.pending;
        }
        const askedFor = this.generation;
        const pending = firstValueFrom(
            this.http.get<ConsoleManifestResponse>(ConsoleAccessService.URL).pipe(
                map((response): Asked => ({ access: 'granted', response })),
                catchError((error: unknown) => of<Asked>({
                    access: error instanceof HttpErrorResponse && 403 === error.status ? 'refused' : 'unknown',
                    response: null,
                })),
            ),
        ).then(({ access, response }): Promise<ConsoleAccess> | ConsoleAccess => {
            if (askedFor !== this.generation) {
                return this.ensure();
            }
            if (null !== response) {
                this.merge(response);
            }
            this.pending = null;
            this.answer  = access;
            return access;
        });
        this.pending = pending;

        return pending;
    }

    /**
     * Sign a refused account out: this sign-in ends on the server (its refresh token
     * with it), as the account menu's sign-out does, and then in this browser --
     * whatever the server answered, so a refused request cannot leave it signed in.
     */
    signOut(): Observable<void> {
        const logout = this.store.selectSnapshot(AppConfigState.manifest)?.auth?.logout ?? '/api/v1/auth/logout';

        return this.http.post(logout, null).pipe(
            catchError(() => of(null)),
            switchMap(() => this.store.dispatch(new Logout())),
            map(() => undefined),
        );
    }

    private merge(response: ConsoleManifestResponse): void {
        const config = this.store.selectSnapshot(AppConfigState.config);
        this.store.dispatch(new SetAppConfig({
            ...(config ?? {}),
            manifest: { ...(config?.manifest ?? {}), ...response.manifest },
        }));
    }
}

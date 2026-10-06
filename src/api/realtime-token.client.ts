import { Injectable, Injector, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { defer, switchMap, throwError, type Observable } from 'rxjs';

import { ConsoleAccessService } from '../bootstrap/console-access.service';
import { AppConfigState } from '../state/app-config.state';
import type { ApiManifest } from './api-manifest.types';

/**
 * Response of `POST /centrifugo/connection-token`: the JWT the realtime SDK
 * opens its socket with, and what it needs to refresh before expiry.
 */
export interface CentrifugoConnectionTokenDto {
    token:      string;
    expiresAt:  number;
    ttl:        number;
    wsUrl:      string;
    /**
     * The code the server closes this connection with when the caller's session
     * ended (a sign-out everywhere, a password change, a deactivation). On it the
     * client signs out and ends its calls at once, without reconnecting or waiting
     * for a 401 (2026-09-26). Absent from a server older than that.
     */
    sessionEndedCode?: number;
}

/**
 * Response of `POST /centrifugo/subscription-token`: a per-channel JWT. The
 * SDK asks for one before subscribing to a private namespace, so this is
 * fetched per subscription rather than once per connection.
 */
export interface CentrifugoSubscriptionTokenDto {
    channel:   string;
    token:     string;
    expiresAt: number;
    ttl:       number;
}

/**
 * The two realtime endpoints, carved out for the same reason the identity ones
 * were: the UI kit's realtime client needed exactly these two of `ApiService`'s
 * 117 methods, and depending on the whole thing would have pulled the entire
 * application's wire vocabulary underneath the kit.
 *
 * They belong in core rather than in the kit because both answers are derived
 * from things core already owns -- the boot manifest for the URL, and the auth
 * interceptor for the bearer token that authorises the request. A token is
 * session state, not a widget.
 *
 * `ApiService` keeps its identical signatures and delegates here, so nothing
 * calling it had to change.
 *
 * !! Access first, then realtime (Dmitry, 2026-09-28): "The console opens a realtime
 * connection before the access check. Reverse the order ... A refused account opens no
 * socket." The socket cannot open without the connection token, and anything may ask for
 * one early -- the ring subscription is built at app init and asks as soon as a user is
 * set, before the guard's answer is in. So the token waits for the console's answer (the
 * guard's own request, not a second one) and a refused sign-in gets none: no request, no
 * socket. A failure to ask is not a refusal, as at the guard.
 *
 * Since 2026-10-06 the connection token is every signed-in account's (Dmitry, (c), option 2:
 * "The connection token only opens a socket; each channel is authorized when it is subscribed
 * to"), and a current server answers the admin manifest to every signed-in account, so no
 * sign-in is refused and every one gets its token; each subscription is then decided by its
 * channel. The wait stays for a server from before that, where a refused sign-in still opens
 * no socket.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeTokenClient {
    /** The error a refused sign-in's connection-token request ends with. */
    static readonly REFUSED = 'no console access: no realtime connection';

    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);
    // Resolved when a connection token is asked for, not with this client: ApiService
    // delegates here and is built in many places that never open a socket.
    private readonly injector = inject(Injector);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    connectionToken(): Observable<CentrifugoConnectionTokenDto> {
        return defer(() => this.injector.get(ConsoleAccessService).ensure()).pipe(
            switchMap(access => 'refused' === access
                ? throwError(() => new Error(RealtimeTokenClient.REFUSED))
                : this.http.post<CentrifugoConnectionTokenDto>(this.manifest.apiBase + '/centrifugo/connection-token', {})),
        );
    }

    subscriptionToken(channel: string): Observable<CentrifugoSubscriptionTokenDto> {
        return this.http.post<CentrifugoSubscriptionTokenDto>(
            this.manifest.apiBase + '/centrifugo/subscription-token', { channel });
    }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { type Observable } from 'rxjs';

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
 */
@Injectable({ providedIn: 'root' })
export class RealtimeTokenClient {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    connectionToken(): Observable<CentrifugoConnectionTokenDto> {
        return this.http.post<CentrifugoConnectionTokenDto>(
            this.manifest.apiBase + '/centrifugo/connection-token', {});
    }

    subscriptionToken(channel: string): Observable<CentrifugoSubscriptionTokenDto> {
        return this.http.post<CentrifugoSubscriptionTokenDto>(
            this.manifest.apiBase + '/centrifugo/subscription-token', { channel });
    }
}

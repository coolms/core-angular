import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { AppConfigState } from '../state/app-config.state';
import type { ApiManifest } from './api-manifest.types';
import type { TokenResponse, UserDto } from './auth.types';

/**
 * The identity endpoints core owns: the session lifecycle, plus the settings
 * read at boot.
 *
 * Carved out of the admin's `ApiService` -- 2410 lines, 118 methods and 89 DTOs
 * spanning calendars, documents, calls, VFS and the rest. Core cannot depend on
 * that and still ship beneath the UI kit: it would drag every module's wire
 * types down with it. Core called exactly FOUR of those methods.
 *
 * `logout` is the one addition, and not for symmetry: the auth lifecycle lives
 * here (state, refresh coordinator, cross-tab sync), so a core package that
 * could sign in but not out would be incomplete.
 *
 * `ApiService` keeps its own identical signatures and delegates here, so none
 * of the 94 feature files calling it changed.
 */
@Injectable({ providedIn: 'root' })
export class IdentityApiClient {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);

    /** URLs come from the boot manifest, which core already owns. */
    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    login(identifier: string, password: string): Observable<TokenResponse> {
        return this.http.post<TokenResponse>(this.manifest.auth!.login, { identifier, password });
    }

    refresh(refreshToken: string): Observable<TokenResponse> {
        return this.http.post<TokenResponse>(this.manifest.auth!.refresh, { refreshToken });
    }

    logout(): Observable<void> {
        return this.http.post<void>(this.manifest.auth!.logout, {});
    }

    me(): Observable<UserDto> {
        return this.http.get<UserDto>(this.manifest.auth!.me);
    }

    getSettings(): Observable<Record<string, Record<string, unknown>>> {
        // Force plain JSON. Angular's default Accept carries a wildcard, which
        // makes the backend prefer application/ld+json -- and the section keys
        // are then lost inside the Hydra member array.
        return this.http.get<Record<string, Record<string, unknown>>>(
            this.manifest.identity!.settingsUrl,
            { headers: { Accept: 'application/json' } },
        );
    }
}

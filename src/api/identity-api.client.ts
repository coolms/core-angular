import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { type Observable, finalize, shareReplay } from 'rxjs';

import { AppConfigState } from '../state/app-config.state';
import { AUTH_AUDIENCE } from './auth-audience';
import type { ApiManifest } from './api-manifest.types';
import type { TokenResponse, UserDto } from './auth.types';

/** One declared setting as the server reads it for the person: the value in force, and what they set themselves. */
export interface DeclaredSettingKey {
    readonly key: string;
    /** The value in force: the person's own, else the installation's. */
    readonly value: unknown;
    /** What the person set themselves; null when they set nothing and the installation's value applies. */
    readonly own: unknown;
    readonly locked: boolean;
}

/** One section of the person's declared settings. */
export interface DeclaredSettingsSection {
    readonly section: string;
    readonly keys: ReadonlyArray<DeclaredSettingKey>;
}

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
    private readonly audience = inject(AUTH_AUDIENCE);

    /** The settings read while it is in flight, shared by every caller that asks meanwhile. */
    private settingsRead$?: Observable<Record<string, Record<string, unknown>>>;

    /** URLs come from the boot manifest, which core already owns. */
    private get manifest(): ApiManifest {
        const m = this.store.selectSnapshot(AppConfigState.manifest);
        if (!m) throw new Error('ApiManifest not loaded — call AppInitService.load() first');
        return m;
    }

    /** Signs in; names the application's audience ({@link AUTH_AUDIENCE}) when it provides one. */
    login(identifier: string, password: string): Observable<TokenResponse> {
        const body = this.audience === null
            ? { identifier, password }
            : { identifier, password, audience: this.audience };
        return this.http.post<TokenResponse>(this.manifest.auth!.login, body);
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

    /**
     * The person's settings. Several services read them at start-up, each for its own section; callers that ask while
     * a read is in flight share it, so the page makes one request. A call after it has answered reads again: nothing
     * is kept past the answer, so a save is never hidden behind an old read.
     */
    getSettings(): Observable<Record<string, Record<string, unknown>>> {
        if (this.settingsRead$) return this.settingsRead$;

        // Force plain JSON. Angular's default Accept carries a wildcard, which
        // makes the backend prefer application/ld+json -- and the section keys
        // are then lost inside the Hydra member array.
        const read$ = this.http.get<Record<string, Record<string, unknown>>>(
            this.manifest.identity!.settingsUrl,
            { headers: { Accept: 'application/json' } },
        ).pipe(
            finalize(() => {
                if (this.settingsRead$ === read$) this.settingsRead$ = undefined;
            }),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
        this.settingsRead$ = read$;

        return read$;
    }

    /**
     * The person's settings as declared: each section's keys with the value in force and the person's own (null when
     * they set none). `host` picks the sections a host reads (`console` for the admin); none gives every section.
     */
    getDeclaredSettings(host?: string): Observable<ReadonlyArray<DeclaredSettingsSection>> {
        const query = host === undefined ? '' : `?host=${encodeURIComponent(host)}`;

        return this.http.get<ReadonlyArray<DeclaredSettingsSection>>(
            `${this.manifest.identity!.settingsUrl}/declared${query}`,
            { headers: { Accept: 'application/json' } },
        );
    }
}

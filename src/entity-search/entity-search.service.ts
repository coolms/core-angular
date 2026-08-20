import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * One row returned by the `/api/entity-search` endpoint. `id` is
 * what the picker emits via its `valueChange` output (and what the
 * template's persisted context carries). `label` is the primary
 * display line. `secondary` is an optional second line for
 * disambiguation (email, slug, etc.) — the backend omits the key
 * when there is nothing to show; receiving `null` from a custom
 * resolver is normalized to `undefined` here.
 */
export interface EntitySearchResult {
    readonly id:         string | number;
    readonly label:      string;
    readonly secondary?: string;
}

/**
 * HTTP client for the Phase 2a `/api/entity-search` endpoint.
 * Returns a stream of search results for the given entity FQCN.
 * Permission filtering happens at the backend resolver layer —
 * this service is a thin RPC.
 */
@Injectable({ providedIn: 'root' })
export class EntitySearchService {
    private readonly http = inject(HttpClient);

    /**
     * @param entityType  Fully-qualified PHP class name of the entity
     *                    being searched (e.g. the backend's User entity).
     * @param query       Free-text search input. Empty string is
     *                    valid — the backend returns the default
     *                    listing for that entity type.
     * @param limit       Max rows to return; clamped server-side to
     *                    [1, 100].
     */
    search(entityType: string, query: string, limit = 20): Observable<EntitySearchResult[]> {
        const params = new HttpParams()
            .set('type', entityType)
            .set('q', query)
            .set('limit', String(limit));

        return this.http.get<EntitySearchResult[]>('/api/entity-search', { params });
    }
}

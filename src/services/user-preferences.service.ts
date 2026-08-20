import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Subject, debounceTime } from 'rxjs';
import { AppConfigState } from '../state/app-config.state';
import { DataGridPreference } from './user-preferences.types';

/**
 * Unified user preferences service — all preference types share one
 * localStorage key (`coolms_ui_prefs`) and one debounced server-sync pipeline.
 *
 * Key naming convention (stored as nested objects, referenced via dot-notation):
 *
 *   // Grids
 *   grids.{gridId}.columns
 *   grids.{gridId}.columnWidths
 *
 *   // Panels (ExplorerLayout persistKey values from YAML)
 *   panel.{persistKey}.width
 *   panel.{persistKey}.collapsed
 *
 *   // Page navigation state
 *   page.vfs.lastPath
 *   page.vfs.viewMode
 *   page.media.lastDir
 *   page.media.viewMode
 *
 *   // Global
 *   nav.lastRoute
 *   terminal.height
 *   terminal.open
 */
@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
    private readonly http       = inject(HttpClient);
    private readonly store      = inject(Store);
    private readonly destroyRef = inject(DestroyRef);

    private readonly STORAGE_KEY = 'coolms_ui_prefs';
    private readonly SYNC_DELAY  = 2000; // ms

    private syncSubject = new Subject<Record<string, unknown>>();

    constructor() {
        // Debounced sync to server — batches rapid changes (e.g. live resize)
        this.syncSubject.pipe(
            debounceTime(this.SYNC_DELAY),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(prefs => this.syncToServer(prefs));
    }

    // ── Core helpers ─────────────────────────────────────────────────────────

    /**
     * Write all prefs to localStorage and schedule a debounced server sync.
     */
    private save(all: Record<string, unknown>): void {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
        this.syncSubject.next(all);
    }

    /**
     * Read the entire prefs object from localStorage, applying legacy key
     * migration on the first read after an upgrade.
     */
    private load(): Record<string, unknown> {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            const all: Record<string, unknown> = raw ? JSON.parse(raw) : {};
            return this.migrate(all);
        } catch {
            return {};
        }
    }

    /**
     * One-time migration of legacy flat keys to the new nested naming convention.
     * Mutates `all` in place and re-persists only when something changed.
     */
    private migrate(all: Record<string, unknown>): Record<string, unknown> {
        let dirty = false;

        // terminal_height → terminal.height
        if (typeof all['terminal_height'] === 'number') {
            const terminal = (all['terminal'] ?? {}) as Record<string, unknown>;
            terminal['height'] = all['terminal_height'];
            all['terminal'] = terminal;
            delete all['terminal_height'];
            dirty = true;
        }

        // media_view_mode → page.media.viewMode
        if (typeof all['media_view_mode'] === 'string') {
            const page  = (all['page']  ?? {}) as Record<string, unknown>;
            const media = (page['media'] ?? {}) as Record<string, unknown>;
            media['viewMode'] = all['media_view_mode'];
            page['media'] = media;
            all['page'] = page;
            delete all['media_view_mode'];
            dirty = true;
        }

        // media_collections_panel → panel.media_panel_left  (matches persistKey in media-library.yaml)
        if (all['media_collections_panel'] && typeof all['media_collections_panel'] === 'object') {
            const panel = (all['panel'] ?? {}) as Record<string, unknown>;
            panel['media_panel_left'] = all['media_collections_panel'];
            all['panel'] = panel;
            delete all['media_collections_panel'];
            dirty = true;
        }

        // Normalize namespace arrays to empty objects.
        // The server serialises empty namespaces as [] (JSON array) rather than {}
        // because PHP converts empty associative arrays to JSON arrays. Arrays silently
        // swallow named-property writes and produce "[]" on serialisation, so column/
        // panel preferences would be lost. Convert once and re-persist.
        const NAMESPACES = new Set(['grids', 'panel', 'page', 'terminal', 'nav']);
        for (const ns of NAMESPACES) {
            if (Array.isArray(all[ns])) {
                all[ns] = {};
                dirty = true;
            }
        }

        // Grid keys: any top-level object with `columns` or `columnWidths` → grids.{key}
        for (const key of Object.keys(all)) {
            if (NAMESPACES.has(key)) continue;
            const val = all[key];
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                const obj = val as Record<string, unknown>;
                if ('columns' in obj || 'columnWidths' in obj) {
                    const grids = (all['grids'] ?? {}) as Record<string, unknown>;
                    grids[key]  = obj;
                    all['grids'] = grids;
                    delete all[key];
                    dirty = true;
                }
            }
        }

        if (dirty) {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
        }

        return all;
    }

    // ── Server sync ──────────────────────────────────────────────────────────

    /**
     * Seed localStorage from server preferences.
     * Called after login and on every session restore (page reload).
     *
     * Strategy:
     *  - No local prefs yet (new device / clean install) → use server prefs as-is.
     *  - Local prefs already exist → merge with local taking priority at each
     *    top-level namespace.  This ensures that locally-persisted state
     *    (panel widths, last path, etc.) is never overwritten by the stale copy
     *    that was saved in the auth token at login time.
     */
    loadFromServer(uiPrefs: Record<string, unknown>): void {
        if (Object.keys(uiPrefs).length === 0) return;
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (!raw) {
                // Fresh device — trust the server entirely
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(uiPrefs));
            } else {
                // Local prefs exist — server is the base, local namespaces win
                const local  = JSON.parse(raw) as Record<string, unknown>;
                const merged = { ...uiPrefs, ...local };
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(merged));
            }
        } catch {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(uiPrefs));
        }
    }

    private syncToServer(prefs: Record<string, unknown>): void {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const url      = manifest?.auth?.preferencesUrl;
        if (!url) return;

        this.http.patch(url, { uiPrefs: prefs }, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        }).subscribe({
            error: err => console.warn('Preferences sync failed:', err),
        });
    }

    // ── Grids ────────────────────────────────────────────────────────────────

    /**
     * Get stored preferences for a specific grid.
     */
    getGridPref(gridId: string): DataGridPreference | null {
        try {
            const all   = this.load();
            const grids = all['grids'] as Record<string, unknown> | undefined;
            if (!grids) return null;
            return (grids[gridId] as DataGridPreference) ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Set visible column order for a grid.
     * Applies to localStorage instantly; server sync is debounced.
     */
    setColumns(gridId: string, columns: string[]): void {
        this.updateGrid(gridId, existing => ({ ...existing, columns }));
    }

    /**
     * Record a column width for a grid column.
     * Applies to localStorage instantly; server sync is debounced.
     */
    setColumnWidth(gridId: string, field: string, width: number): void {
        this.updateGrid(gridId, existing => ({
            ...existing,
            columnWidths: {
                ...(existing.columnWidths ?? {}),
                [field]: Math.max(60, width),
            },
        }));
    }

    /**
     * Remove all preferences for a specific grid and immediately sync to server.
     */
    resetGrid(gridId: string): void {
        const all   = this.load();
        const grids = (all['grids'] ?? {}) as Record<string, unknown>;
        delete grids[gridId];
        all['grids'] = grids;
        this.save(all);
        this.syncToServer(all); // immediate sync
    }

    private updateGrid(
        gridId: string,
        updater: (existing: DataGridPreference) => DataGridPreference,
    ): void {
        const all   = this.load();
        const grids = (all['grids'] ?? {}) as Record<string, unknown>;
        grids[gridId] = updater((grids[gridId] as DataGridPreference) ?? {});
        all['grids'] = grids;
        this.save(all);
    }

    // ── Terminal ─────────────────────────────────────────────────────────────

    /**
     * Get persisted terminal panel height.
     */
    getTerminalHeight(): number | null {
        const all      = this.load();
        const terminal = all['terminal'] as Record<string, unknown> | undefined;
        return typeof terminal?.['height'] === 'number' ? terminal['height'] : null;
    }

    /**
     * Persist terminal panel height.
     */
    setTerminalHeight(height: number): void {
        const all      = this.load();
        const terminal = (all['terminal'] ?? {}) as Record<string, unknown>;
        terminal['height'] = Math.round(height);
        all['terminal'] = terminal;
        this.save(all);
    }

    // ── Panel ────────────────────────────────────────────────────────────────

    /**
     * Get persisted state for a resizable panel identified by key.
     * Used by ExplorerLayoutComponent to persist panel widths across sessions.
     */
    getPanelState(key: string): { width: number; collapsed: boolean } | null {
        try {
            const all   = this.load();
            const panel = all['panel'] as Record<string, unknown> | undefined;
            if (!panel) return null;
            const p = panel[key];
            if (!p || typeof p !== 'object') return null;
            const { width, collapsed } = p as Record<string, unknown>;
            return typeof width === 'number' && typeof collapsed === 'boolean'
                ? { width, collapsed }
                : null;
        } catch { return null; }
    }

    /**
     * Persist generic panel state by key.
     * Applies to localStorage instantly; server sync is debounced.
     */
    setPanelState(key: string, width: number, collapsed: boolean): void {
        const all   = this.load();
        const panel = (all['panel'] ?? {}) as Record<string, unknown>;
        panel[key]  = { width: Math.round(width), collapsed };
        all['panel'] = panel;
        this.save(all);
    }

    // ── Page state ───────────────────────────────────────────────────────────

    /**
     * Get all persisted state for a page namespace (e.g. 'vfs', 'media', 'nav').
     */
    getPageState<T>(pageKey: string): T | null {
        try {
            const all  = this.load();
            const page = all['page'] as Record<string, unknown> | undefined;
            if (!page) return null;
            return (page[pageKey] as T) ?? null;
        } catch { return null; }
    }

    /**
     * Merge partial state into a page namespace.
     * Existing keys in the namespace are preserved; only provided keys are updated.
     * Applies to localStorage instantly; server sync is debounced.
     */
    setPageState(pageKey: string, state: Record<string, unknown>): void {
        const all  = this.load();
        const page = (all['page'] ?? {}) as Record<string, unknown>;
        page[pageKey] = { ...(page[pageKey] ?? {}), ...state };
        all['page'] = page;
        this.save(all);
    }

    // ── Media (legacy pass-through — kept for compatibility) ─────────────────

    /** @deprecated Use getPageState('media') instead */
    getMediaViewMode(): string | null {
        return this.getPageState<{ viewMode?: string }>('media')?.viewMode ?? null;
    }

    /** @deprecated Use setPageState('media', ...) instead */
    setMediaViewMode(mode: string): void {
        this.setPageState('media', { viewMode: mode });
    }

    /** @deprecated Use getPanelState('media_panel_left') instead */
    getMediaCollectionsPanel(): { width: number; collapsed: boolean } | null {
        return this.getPanelState('media_panel_left');
    }

    /** @deprecated Use setPanelState('media_panel_left', ...) instead */
    setMediaCollectionsPanel(width: number, collapsed: boolean): void {
        this.setPanelState('media_panel_left', width, collapsed);
    }
}

import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Subject, debounceTime } from 'rxjs';
import { AppConfigState } from '../state/app-config.state';
import { BACKGROUND_REQUEST } from '../auth/elevation.service';
import { ErrorHandlerService } from '../errors/error-handler.service';
import { PREFERENCES_NOTICE } from './preferences-notice.port';
import { type DataGridPreference } from './user-preferences.types';

/** The prefix of a grid's own entry: `datagrid:<gridId>`. */
export const DATAGRID_ENTRY_PREFIX = 'datagrid:';

/** The entry a grid's preferences are kept in. */
export function datagridEntry(gridId: string): string {
    return DATAGRID_ENTRY_PREFIX + gridId;
}

/** Entries kept under these ids before grids had entries of their own; never taken for a grid. */
const NAMESPACES = new Set(['grids', 'panel', 'page', 'terminal', 'nav']);

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A grid entry's columns and widths, without the fields a reset left empty (null); null when it has neither. */
function gridPrefOf(entry: unknown): DataGridPreference | null {
    if (!isObject(entry)) return null;
    const pref: DataGridPreference = {};
    if (Array.isArray(entry['columns'])) pref.columns = entry['columns'] as string[];
    if (isObject(entry['columnWidths'])) pref.columnWidths = entry['columnWidths'] as Record<string, number>;
    return pref.columns === undefined && pref.columnWidths === undefined ? null : pref;
}

/**
 * The person's interface preferences: one localStorage key (`coolms_ui_prefs`) holding the entries the server keeps
 * (PATCH /auth/me/preferences, read back from GET /auth/me's uiPrefs), each an object of fields, by id:
 *
 *   datagrid:{gridId}         { columns, columnWidths }   one entry per grid
 *   panel                     { {persistKey}: { width, collapsed } }
 *   page                      { vfs: {...}, media: {...}, nav: { lastRoute } }
 *   terminal                  { height }
 *
 * A change is written locally at once and sent, debounced, as the entries that changed only; the server merges each
 * entry field by field and leaves every other entry as it was. A refusal (422) is shown to the person through
 * {@link PREFERENCES_NOTICE}. On load the server's value wins for every entry it has.
 */
@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
    private readonly http       = inject(HttpClient);
    private readonly store      = inject(Store);
    private readonly destroyRef = inject(DestroyRef);
    private readonly errors     = inject(ErrorHandlerService);
    private readonly notice     = inject(PREFERENCES_NOTICE, { optional: true });

    private readonly STORAGE_KEY = 'coolms_ui_prefs';
    private readonly SYNC_DELAY  = 2000; // ms

    /** The entries changed since the last send, by id, with the value to send. */
    private readonly pending = new Map<string, unknown>();
    private readonly syncSubject = new Subject<void>();

    constructor() {
        // Debounced sync to server -- batches rapid changes (e.g. live resize)
        this.syncSubject.pipe(
            debounceTime(this.SYNC_DELAY),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => this.flush());
    }

    // -- Core helpers ---------------------------------------------------------

    /** Writes all entries locally, and schedules a debounced send of the entries named. */
    private save(all: Record<string, unknown>, ...changed: string[]): void {
        this.write(all);
        for (const id of changed) {
            this.pending.set(id, all[id] ?? {});
        }
        this.syncSubject.next();
    }

    private write(all: Record<string, unknown>): void {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
        } catch {
            /* storage denied -- the server keeps the entries */
        }
    }

    private readLocal(): Record<string, unknown> {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            const all: unknown = raw ? JSON.parse(raw) : {};
            return isObject(all) ? all : {};
        } catch {
            return {};
        }
    }

    /**
     * Read the entire prefs object from localStorage, applying legacy key
     * migration on the first read after an upgrade.
     */
    private load(): Record<string, unknown> {
        const all = this.readLocal();
        if (this.migrate(all)) {
            this.write(all);
        }
        return all;
    }

    /**
     * Older shapes, moved to today's in place; true when something moved. Each grid gets its own `datagrid:<id>`
     * entry -- from the nested `grids` entry, or a flat grid key older still -- unless it already has one; a moved
     * grid's entry is queued to be sent, so the server keeps the same shape.
     */
    private migrate(all: Record<string, unknown>): boolean {
        let dirty = false;

        // terminal_height -> terminal.height
        if (typeof all['terminal_height'] === 'number') {
            const terminal = (isObject(all['terminal']) ? all['terminal'] : {});
            terminal['height'] = all['terminal_height'];
            all['terminal'] = terminal;
            delete all['terminal_height'];
            dirty = true;
        }

        // media_view_mode -> page.media.viewMode
        if (typeof all['media_view_mode'] === 'string') {
            const page  = (isObject(all['page']) ? all['page'] : {});
            const media = (isObject(page['media']) ? page['media'] : {});
            media['viewMode'] = all['media_view_mode'];
            page['media'] = media;
            all['page'] = page;
            delete all['media_view_mode'];
            dirty = true;
        }

        // media_collections_panel -> panel.media_panel_left  (matches persistKey in media-library.yaml)
        if (isObject(all['media_collections_panel'])) {
            const panel = (isObject(all['panel']) ? all['panel'] : {});
            panel['media_panel_left'] = all['media_collections_panel'];
            all['panel'] = panel;
            delete all['media_collections_panel'];
            dirty = true;
        }

        // An entry is an object of fields. The server serialises an empty one as [] (PHP writes an empty
        // associative array as a JSON array), and an array silently swallows named-property writes.
        for (const id of Object.keys(all)) {
            if (Array.isArray(all[id])) {
                all[id] = {};
                dirty = true;
            }
        }

        const moved: string[] = [];
        const toEntry = (gridId: string, pref: unknown): void => {
            const id = datagridEntry(gridId);
            if (isObject(pref) && !(id in all)) {
                all[id] = pref;
                moved.push(id);
            }
        };

        // Flat grid keys, older than the nested shape: a top-level object with `columns` or `columnWidths` whose id
        // is not an entry id (entry ids carry a colon, `admin:mail:panes`).
        for (const key of Object.keys(all)) {
            if (NAMESPACES.has(key) || key.includes(':') || !isObject(all[key])) continue;
            const obj = all[key];
            if ('columns' in obj || 'columnWidths' in obj) {
                toEntry(key, obj);
                delete all[key];
                dirty = true;
            }
        }

        // grids.{gridId} -> datagrid:{gridId}
        if ('grids' in all) {
            const grids = all['grids'];
            if (isObject(grids)) {
                for (const [gridId, pref] of Object.entries(grids)) {
                    toEntry(gridId, pref);
                }
            }
            delete all['grids'];
            dirty = true;
        }

        if (moved.length > 0) {
            for (const id of moved) {
                this.pending.set(id, all[id]);
            }
            this.syncSubject.next();
        }

        return dirty;
    }

    // -- Server sync ----------------------------------------------------------

    /**
     * Takes the server's preferences (GET /auth/me's uiPrefs), after sign-in and on every load: for every entry the
     * server has, its value wins over the local one; an entry only this browser has is kept. An entry changed here
     * and not yet sent keeps its local value: it is newer, and on its way. The server's nested `grids` entry gives a
     * grid its own entry only where neither side has one.
     */
    loadFromServer(uiPrefs: Record<string, unknown>): void {
        if (!isObject(uiPrefs) || Object.keys(uiPrefs).length === 0) return;
        const all = this.readLocal();
        const oldGrids = isObject(uiPrefs['grids']) ? { ...uiPrefs['grids'] } : null;
        for (const [id, value] of Object.entries(uiPrefs)) {
            if (id === 'grids' || this.pending.has(id)) continue;
            all[id] = value;
        }
        if (oldGrids !== null) {
            // Merged under the local nested entry, if one is still there: either becomes a grid's entry only
            // where the grid has none.
            all['grids'] = { ...oldGrids, ...(isObject(all['grids']) ? all['grids'] : {}) };
        }
        this.migrate(all);
        this.write(all);
    }

    /** Sends the entries changed since the last send, those only. */
    private flush(): void {
        if (this.pending.size === 0) return;
        const entries = Object.fromEntries(this.pending);
        this.pending.clear();
        this.syncToServer(entries);
    }

    private syncToServer(entries: Record<string, unknown>): void {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const url      = manifest?.auth?.preferencesUrl;
        if (!url) return;

        this.http.patch(url, { uiPrefs: entries }, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
            // Sent on the way, by no one's action.
            context: new HttpContext().set(BACKGROUND_REQUEST, true),
        }).subscribe({
            error: (err: unknown) => this.refused(err, entries),
        });
    }

    /**
     * A send that failed. A refusal (422) stored nothing and would be refused again: the person is told, in the
     * server's words. Any other failure keeps the entries to send with the next change (one changed since is newer).
     */
    private refused(err: unknown, entries: Record<string, unknown>): void {
        if (err instanceof HttpErrorResponse && err.status === 422) {
            const sentence = `Your preferences could not be saved: ${this.errors.humanize(err)}`;
            if (this.notice) {
                this.notice.refused(sentence);
            } else {
                console.warn(sentence);
            }
            return;
        }
        for (const [id, value] of Object.entries(entries)) {
            if (!this.pending.has(id)) {
                this.pending.set(id, value);
            }
        }
        console.warn('Preferences sync failed:', err);
    }

    // -- Grids ----------------------------------------------------------------

    /**
     * Get stored preferences for a specific grid: its `datagrid:<gridId>` entry, without the fields a reset left
     * empty; null when it has none.
     */
    getGridPref(gridId: string): DataGridPreference | null {
        return gridPrefOf(this.load()[datagridEntry(gridId)]);
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
     * Remove all preferences for a specific grid, and send at once: the server keeps an entry it was once sent,
     * so the grid's fields are sent empty (null), which it stores as they come.
     */
    resetGrid(gridId: string): void {
        const id  = datagridEntry(gridId);
        const all = this.load();
        delete all[id];
        this.write(all);
        this.pending.set(id, { columns: null, columnWidths: null });
        this.flush();
    }

    private updateGrid(
        gridId: string,
        updater: (existing: DataGridPreference) => DataGridPreference,
    ): void {
        const id  = datagridEntry(gridId);
        const all = this.load();
        const entry = isObject(all[id]) ? all[id] : {};
        all[id] = { ...entry, ...updater(gridPrefOf(entry) ?? {}) };
        this.save(all, id);
    }

    // -- Terminal -------------------------------------------------------------

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
        const terminal = (isObject(all['terminal']) ? all['terminal'] : {});
        terminal['height'] = Math.round(height);
        all['terminal'] = terminal;
        this.save(all, 'terminal');
    }

    // -- Panel ----------------------------------------------------------------

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
        const panel = (isObject(all['panel']) ? all['panel'] : {});
        panel[key]  = { width: Math.round(width), collapsed };
        all['panel'] = panel;
        this.save(all, 'panel');
    }

    // -- Page state -----------------------------------------------------------

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
        const page = (isObject(all['page']) ? all['page'] : {});
        page[pageKey] = { ...(isObject(page[pageKey]) ? page[pageKey] : {}), ...state };
        all['page'] = page;
        this.save(all, 'page');
    }

    // -- Media (legacy pass-through -- kept for compatibility) -----------------

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

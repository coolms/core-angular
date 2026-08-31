import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { map, type Observable, shareReplay } from 'rxjs';
import { AppConfigState } from '../state/app-config.state';

/**
 * Layout config DTO -- the shape served from
 * `GET /api/v1/config/layout/{id}`. Mirrors the YAML at
 * `config/modules/{module}/layout/*.yaml`.
 *
 * The optional fields below are the page-level contract
 * every admin SPA page resolves through. The base contract (id /
 * template / title / icon / slots) is the legacy list shape and stays
 * untouched. Existing 17 list YAMLs render identically when the new
 * fields are absent.
 *
 * New optional fields:
 *  - `subtitle`         one-line page description rendered under the title
 *  - `sections`         ordered map of body sections, each with its own slot graph
 *                       (replaces single-slot `slots:` for multi-section pages)
 *  - `headerActions`    buttons displayed in the cms-page-header action bar
 *  - `permissions`      hint for clients about who this page targets; real gating
 *                       lives on the data APIs the slot components consume
 *                       (the layout endpoint itself is public by design --
 *                       layouts carry only structure, never data)
 *
 * `[key: string]: unknown` index signature stays so existing per-page
 * keys (e.g. `media:library`'s `naviGraph:` slot shorthand) keep working
 * without further interface changes.
 */
export interface LayoutHeaderAction {
    id:        string;
    label?:    string;
    icon?:     string;
    title?:    string;
    primary?:  boolean;
    danger?:   boolean;
    disabled?: boolean;
    /**
     * Optional capability gate evaluated FE-side against runtime state
     * (e.g. `administer` / `delete`) — the config declares WHICH actions
     * exist + their gate; the FE decides if THIS user/row qualifies. Absent
     * = always shown. Used by detail pages whose actions are config-driven
     * (see `web:section-detail`).
     *
     * For a gate that depends on the RECORD rather than the user, prefer
     * `showWhen` below: `requires` needs a page to interpret the token, so
     * every new value costs a branch in TypeScript.
     */
    requires?: string;
    /**
     * Conditions on the page's published context, same grammar and same
     * evaluator as a NaviGraph toolbar node, applied
     * by {@link LayoutActionsService}:
     *
     *   showWhen     — the action does not APPLY, so it is absent.
     *   disabledWhen — temporarily UNAVAILABLE: stays put and greys out.
     *   busyWhen     — the action is RUNNING: greys out too, and may relabel.
     *   busyLabel    — label shown while `busyWhen` holds ("Saving…").
     *   activeWhen   — pressed/active styling.
     *
     * Two carriers (a layout config and a NaviGraph tree) but ONE vocabulary:
     * a page that moves between them should not have to relearn how to say
     * "not now".
     */
    showWhen?:     Record<string, unknown>;
    disabledWhen?: Record<string, unknown>;
    busyWhen?:     Record<string, unknown>;
    busyLabel?:    string;
    activeWhen?:   Record<string, unknown>;
}

export interface LayoutSection {
    title?: string;
    /**
     * When true, the layout shell pins the section to the top of the
     * scroll container (CSS `position: sticky`). Used by inspector /
     * filter pages where an input form should stay visible while the
     * operator scrolls through results below. Currently honoured by
     * cms-inspector-layout; cms-detail-layout will follow when it
     * lands. Default false.
     */
    sticky?: boolean;
    slots?: Record<string, { component?: string; [key: string]: unknown }>;
    [key: string]: unknown;
}

export interface LayoutConfig {
    id?:            string;
    template?:      string;
    title?:         string;
    subtitle?:      string;
    icon?:          string;
    slots?:         Record<string, unknown>;
    sections?:      Record<string, LayoutSection>;
    headerActions?: LayoutHeaderAction[];
    /**
     * Actions rendered in the page's fixed bottom bar (`<cms-detail-footer>`)
     * — primary / destructive actions kept out of the cramped header.
     * Same shape as `headerActions`; gated per-item via `requires`.
     */
    footerActions?: LayoutHeaderAction[];
    permissions?:   string[];
    [key: string]:  unknown;
}
export interface DialogConfig    { [key: string]: unknown; }
export interface NavigraphConfig { [key: string]: unknown; }
export interface FormConfig      { [key: string]: unknown; }
export interface DatagridConfig  { [key: string]: unknown; }

/**
 * Fetches config YAMLs (served as JSON) from GET /api/v1/config/{type}/{id}.
 *
 * Responses are cached for the lifetime of the service (Map + shareReplay(1))
 * so repeated calls never re-fetch the same resource.
 *
 * configBase is read from the API manifest (manifest.configBase) and falls
 * back to '/api/v1/config' when the manifest is not yet loaded.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
    private readonly http  = inject(HttpClient);
    private readonly store = inject(Store);
    private readonly cache = new Map<string, Observable<unknown>>();

    layout(id: string):     Observable<LayoutConfig>    { return this.fetch<LayoutConfig>('layout', id); }
    dialog(id: string):     Observable<DialogConfig>    { return this.fetch<DialogConfig>('dialog', id); }
    navigraph(slug: string): Observable<NavigraphConfig> { return this.fetch<NavigraphConfig>('navigraph', slug); }
    form(id: string):       Observable<FormConfig>      { return this.fetch<FormConfig>('form', id); }
    datagrid(id: string):   Observable<DatagridConfig>  { return this.fetch<DatagridConfig>('datagrid', id); }

    private fetch<T>(type: string, id: string): Observable<T> {
        const key = `${type}/${id}`;

        if (!this.cache.has(key)) {
            const base = this.store.selectSnapshot(AppConfigState.manifest)?.configBase
                ?? '/api/v1/config';
            // The config endpoint wraps the YAML payload in a `data` field:
            // { type, id, data: { ...yaml content... } }
            // Unwrap so callers always receive the config payload directly.
            const obs  = this.http.get<{ data?: T } & T>(`${base}/${type}/${id}`).pipe(
                map(r => (r.data ?? r) as T),
                shareReplay(1),
            );
            this.cache.set(key, obs);
        }

        return this.cache.get(key) as Observable<T>;
    }
}

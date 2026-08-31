// ─── NaviGraph API types ──────────────────────────────────────────────────────
// Mirror the PHP NaviGraphNodeResource DTO exactly. No `any` allowed.

/**
 * Well-known click target values embedded in meta.target.
 *   'action.logout' — dispatch Logout action
 *   'route'         — navigate via routerLink (default when target absent)
 *   '_blank'        — open in a new tab (hrefOverride must be set)
 */
// `& {}` rather than a bare `| string`, which absorbs the three literals and
// leaves the type meaning "any string" -- the docblock above would then be
// describing a union the compiler had already erased.
export type NaviGraphTarget = 'action.logout' | 'route' | '_blank' | (string & {});

export interface NaviGraphMeta {
    readonly component?:       string;           // e.g. 'identity.signout'
    readonly icon?:            string;           // icon name hint for the renderer
    readonly routerLink?:      string;           // Angular router path, e.g. 'navi'
    readonly target?:          NaviGraphTarget;  // click behaviour override
    readonly requiredRole?:    string;           // backend-side role guard
    readonly voterAttribute?:  string;           // PHP-side Voter guard
    readonly contributor?:     string;           // set by NaviGraphSeeder (read-only)
    readonly [key: string]:    unknown;
}

/** Flat node as returned from GET /navi/trees/{slug}/graph */
export interface NaviGraphNodeFlat {
    readonly id:        string;
    readonly path:      string;
    readonly title:     string;
    readonly parentId:  string | null;
    readonly sortOrder: number;
    readonly isActive:  boolean;
    readonly isVisible: boolean;
    readonly meta:      NaviGraphMeta;
}

/** Same node enriched with resolved children after client-side tree build */
export interface NaviGraphNode extends NaviGraphNodeFlat {
    readonly children: NaviGraphNode[];
}

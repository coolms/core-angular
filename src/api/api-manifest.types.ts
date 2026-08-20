// Typed contract — must mirror ApiManifest PHP VOs exactly.
// No `any` anywhere.

export interface AuthApiManifest {
    readonly login:           string;
    readonly logout:          string;
    readonly refresh:         string;
    readonly register:        string;
    readonly me:              string;
    readonly usersApi?:       string;  // GET /api/v1/auth/users
    readonly groupsApi?:      string;  // GET /api/v1/auth/groups
    readonly preferencesUrl?: string;  // PATCH /api/v1/auth/me/preferences
    readonly groupFormId?:    string | null;
    readonly userFormId?:     string | null;
}

export interface SectionApiManifest {
    readonly list:    string;
    readonly create:  string;
    readonly item:    string;   // URL pattern: /api/v1/sections/{id}
    readonly update:  string;
    readonly delete:  string;
    readonly formId?: string;
    readonly apply?:  string;   // POST /api/v1/sections/_apply (H9)
}

export interface NaviApiManifest {
    readonly treesList:       string;
    readonly treesCreate:     string;
    readonly treesItem:       string;  // pattern: /api/v1/navi/trees/{slug}
    readonly nodesList:       string;
    readonly nodesCreate:     string;
    readonly nodesItem:       string;  // pattern: /api/v1/navi/nodes/{id}
    readonly nodesReorder:    string;  // PATCH /api/v1/navi/nodes/reorder
    readonly nodesMove:       string;  // pattern: /api/v1/navi/nodes/{id}/move
    readonly nodesByTree:     string;  // pattern: /api/v1/navi/trees/{slug}/nodes
    readonly treesFormId?:    string;
    readonly nodesFormId?:    string;
    readonly adminNavGraph?:   string;  // /api/v1/navi/trees/navi.admin/graph
    readonly topbarNavGraph?:  string;  // /api/v1/navi/trees/navi.admin.topbar/graph
    readonly toolbarVfsGraph?: string;  // /api/v1/navi/trees/navi.toolbar.vfs/graph
    readonly graphBySlug?:     string;  // URL pattern: /api/v1/navi/trees/{slug}/graph
}

export interface ContentApiManifest {
    // Page + variant CRUD lives on the generic VFS node endpoints, filtered
    // by mime where needed; what stays here is Content-owned surface.
    readonly variantPublishUrl: string;  // pattern: /api/v1/content/variants/{id}/publish
    // Pages admin. Optional because a client built against an older backend
    // will not receive them, and the affected control degrades (an empty
    // space list, a picker with only "Default") rather than throwing.
    //
    // The five `articleXxxUrl` fields that stood here are GONE with the
    // endpoints they named. Placement destinations now
    // come from `/content/pages/surfaces` — still never hardcoded on the
    // client, because a surface is configuration, not a product concept.
    readonly pageSpacesUrl?: string;     // /api/v1/content/pages/spaces
    readonly pageTypesUrl?: string;      // /api/v1/content/page-types
}

export interface DataGridApiManifest {
    readonly configBase: string;  // base URL: /api/v1/datagrids
}

export interface TerminalApiManifest {
    readonly executeUrl:  string;  // POST /api/v1/terminal/execute (SSE)
    readonly completeUrl: string;  // POST /api/v1/terminal/complete
}

export interface MediaApiManifest {
    readonly listUrl:                  string;  // GET   /media
    readonly itemUrl:                  string;  // pattern: /api/v1/media/{id}
    readonly permissionsUrl:           string;  // pattern: /api/v1/media/{id}/permissions
    readonly regenerateUrl:            string;  // pattern: /api/v1/media/{id}/regenerate
    readonly resizeUrl:                string;  // pattern: /media/resize/{id}
    readonly collectionsUrl:           string;  // GET   /api/v1/media/collections
    readonly collectionsCreateUrl:     string;  // POST  /api/v1/media/collections
    readonly collectionPermissionsUrl: string;  // PATCH /api/v1/media/collections/permissions
    readonly moveUrl?:                 string;  // pattern: /api/v1/media/{id}/move
    readonly spacesUrl?:               string;  // GET   /api/v1/media/spaces
}

export interface VfsApiManifest {
    readonly fileContentUrl: string;  // GET/PUT  /api/v1/vfs/files/content?path={path}
    readonly binaryWriteUrl: string;  // POST     /api/v1/vfs/files/binary (multipart)
}

/**
 * Document module URL section. Today the only entry is `spacesUrl`;
 * the struct is reserved so future Document-module URLs can land
 * here without a new manifest section.
 */
export interface DocumentApiManifest {
    readonly spacesUrl?: string;  // GET /api/v1/document/spaces
}

export interface DynamicEntityApiManifest {
    readonly typesUrl:                   string;  // GET /api/v1/dynamic-entity/types
    readonly fieldDefinitionsUrl:        string;  // POST /api/v1/field/definitions
    readonly fieldDefinitionUrl:         string;  // PUT/PATCH/DELETE /api/v1/field/definitions/{id}
    readonly fieldDefinitionsReorderUrl: string;  // PATCH /api/v1/field/definitions/reorder
    readonly toolbarNaviGraphUrl:        string;  // GET /navi/trees/navi.toolbar.dynamic-entity/graph
    readonly constraintsUrl:             string;  // GET /api/v1/dynamic-entity/constraints
    readonly recordsUrl:                 string;  // pattern: GET/POST /api/v1/dynamic-entity/{type}/records
    readonly recordUrl:                  string;  // pattern: GET/PATCH/DELETE .../records/{id}
    readonly recordsByTypeUrl:           string;  // pattern: GET/POST /api/v1/dynamic-entity/{type}/records
    readonly typeUrl:                    string;  // GET/PATCH/DELETE .../types/{id}
    readonly typesCreateUrl:             string;  // POST .../types (same as typesUrl)
    readonly formTypesUrl?:              string;  // GET /api/v1/field/form-types
    readonly typeByAliasUrl?:            string;  // GET /api/v1/dynamic-entity/types/{alias}
}

export interface DomainExplorerApiManifest {
    readonly entitiesUrl:              string;  // GET /api/v1/domain-explorer/entities
    readonly entityUrl:                string;  // pattern: /api/v1/domain-explorer/entities/{entityAlias}
    readonly toolbarNaviGraphUrl:      string;  // GET /navi/trees/navi.toolbar.domain_explorer/graph
    readonly domainExplorerToolbarUrl: string;  // alias for toolbarNaviGraphUrl (backward compat)
    readonly entityFieldsDataGridUrl?: string;  // GET /api/v1/datagrids/domain_explorer:entity_fields
    readonly typeFieldsDataGridUrl?:   string;  // GET /api/v1/datagrids/domain_explorer:type_fields
}

export interface IdentityApiManifest {
    readonly usersUrl:            string;  // GET /auth/users
    readonly userUrl:             string;  // /auth/users/{id} pattern
    readonly groupsUrl:           string;  // GET /auth/groups
    readonly groupUrl:            string;  // /auth/groups/{id} pattern
    readonly meUrl:               string;  // GET /auth/me
    readonly assignGroupsUrl:     string;  // /auth/users/{id}/groups pattern
    readonly avatarUploadUrl:     string;  // POST /auth/me/avatar
    readonly settingsUrl:         string;  // GET /auth/me/settings
    readonly settingsSectionsUrl: string;  // GET /auth/me/settings/sections
    readonly settingsSectionUrl:  string;  // PATCH /auth/me/settings/{section} pattern
    readonly colorUrl:            string;  // PATCH /auth/me/color
    readonly rolesUrl?:           string;  // GET /api/v1/identity/roles
}

/**
 * Editor sub-manifest emitted by the backend's Editor module. The
 * frontend bridge (`@coolms/editor-angular`) consumes this through the
 * `EDITOR_MANIFEST_PROVIDER` token.
 *
 * schemaVersion 2 (sub-prompt D) replaced the editorId axis with a profile
 * axis: `manifest.editor.profiles[name]` returns a slice with the
 * pre-resolved contributor list AND the storage allow-list a sanitizer
 * enforces on save.
 */
export interface EditorApiManifestEntry {
    readonly id:           string;
    readonly group:        string;
    readonly priority:     number;
    readonly icon:         string;
    readonly label:        string;
    readonly actionType:   string;
    readonly actionParams: Readonly<Record<string, unknown>>;
    readonly extensions:   ReadonlyArray<string>;
    readonly stateKeys:    ReadonlyArray<string>;
    readonly shortcut?:    string | null;
    // `slashable` (derived from `group`) flags the
    // entries the `/`-command palette offers; `keywords` are extra fuzzy-search
    // aliases. Both serialized into `GET /api/v1/theme/config`.
    readonly slashable?:   boolean;
    readonly keywords?:    ReadonlyArray<string>;
}

export interface EditorApiManifestProfile {
    readonly contributors:   ReadonlyArray<EditorApiManifestEntry>;
    readonly allowedWidgets: ReadonlyArray<string>;
}

export interface EditorApiManifest {
    readonly schemaVersion: number;
    readonly profiles:      Readonly<Record<string, EditorApiManifestProfile>>;
}

/**
 * Viewer manifest emitted by the backend's Document module.
 * Each viewer declares the MIME types / extensions it handles, the
 * Angular component selector to dispatch into, and one config blob per
 * profile. Profile config is open-ended — every viewer interprets the
 * keys it understands and ignores the rest.
 */
export interface ViewerProfileApiManifest {
    readonly key:    string;
    readonly config: Readonly<Record<string, unknown>>;
}

export interface ViewerDefinitionApiManifest {
    readonly key:        string;
    readonly mimeTypes:  ReadonlyArray<string>;
    readonly extensions: ReadonlyArray<string>;
    readonly component:  string;
    readonly profiles:   Readonly<Record<string, ViewerProfileApiManifest>>;
}

export interface ViewerApiManifest {
    readonly schemaVersion: number;
    readonly viewers:       Readonly<Record<string, ViewerDefinitionApiManifest>>;
}

/**
 * Platform-wide default user-facing settings. The
 * fallback floor for anonymous / pre-login rendering: timezone, date /
 * time format (CLDR tokens) and week start come from the deployment's
 * config, not an FE-hardcoded Western default. `locale` is the default
 * locale, previously absent from the manifest.
 */
export interface PlatformDefaults {
    readonly locale:     string;
    readonly timezone:   string;
    readonly dateFormat: string;
    readonly timeFormat: '12h' | '24h';
    readonly weekStart:  'monday' | 'sunday';
    /**
     * Deployment brand accent as `#rrggbb`, or null/absent to keep the
     * stylesheet's own. Sits BELOW a user's personal accentColor.
     */
    readonly accentColor?: string | null;
}

export interface ApiManifest {
    readonly apiBase:           string;
    readonly configBase?:       string;  // GET /api/v1/config/{type}/{id}
    readonly auth?:             AuthApiManifest;
    readonly identity?:         IdentityApiManifest;
    readonly sections?:         SectionApiManifest;
    readonly navi?:             NaviApiManifest;
    readonly content?:          ContentApiManifest;
    readonly dataGrid?:         DataGridApiManifest;
    readonly terminal?:         TerminalApiManifest;
    readonly media?:            MediaApiManifest;
    readonly document?:         DocumentApiManifest;
    readonly vfs?:              VfsApiManifest;
    readonly dynamicEntity?:    DynamicEntityApiManifest;
    readonly domainExplorer?:   DomainExplorerApiManifest;
    readonly editor?:           EditorApiManifest;
    readonly viewers?:          ViewerApiManifest;
    readonly supportedLocales?: Array<{ code: string; label: string }>;
    readonly platformDefaults?: PlatformDefaults;
}

export interface ThemeConfigResponse {
    readonly slug?:          string | null;
    readonly feStack?:       string | null;
    readonly spaFramework?:  string | null;
    readonly assetsUrl?:     string | null;
    readonly manifest:       ApiManifest;
}

/**
 * Replaces {param} tokens in a URL pattern with encoded values.
 *
 * @example
 *   resolvePattern(manifest.sections!.item, { id: '123' })
 *   // → '/api/v1/sections/123'
 */
export function resolvePattern(pattern: string, params: Record<string, string>): string {
    return Object.entries(params).reduce(
        (url, [key, value]) => url.replace(`{${key}}`, encodeURIComponent(value)),
        pattern,
    );
}

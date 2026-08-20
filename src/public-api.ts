/**
 * `@coolms/core-angular` -- the CoolMS client runtime for Angular.
 *
 * Everything a CoolMS front-end needs before it has any UI: the session and its
 * refresh/cross-tab machinery, the boot manifest and app config, theme and user
 * preferences, error handling, the HTTP interceptors, and the wire types the
 * backend's form-render and navi-graph endpoints emit.
 *
 * It is deliberately NOT "the admin's core": nothing here is admin chrome. It is
 * also not a general Angular library -- every endpoint it speaks is a CoolMS
 * one, so it is worthless without a CoolMS backend. The layering is
 *
 *     @coolms/core-angular  ->  @coolms/admin-ui-angular  ->  @coolms/x-ui-angular
 *
 * and the reason it must be a package rather than app code is federation: the
 * kit and every remote need this at runtime as ONE `singleton`, and a remote
 * cannot import from its host.
 *
 * This barrel is the whole public surface. Nothing outside `core/` may deep-link
 * past it -- eslint enforces that, so this file is what "core exports" MEANS. A
 * symbol not listed here is internal, and adding one is a deliberate act.
 *
 * The single component (`LoginComponent`) is here on purpose: core owns the auth
 * lifecycle, so it ships a working sign-in rather than leaving every consumer to
 * rebuild one against endpoints only core knows.
 */

// ── Wire types + the API client core owns ────────────────────────────────────
export * from './api/api-manifest.types';
export * from './api/auth.types';
export * from './api/form-render.types';
export * from './api/identity-api.client';

// ── Session ──────────────────────────────────────────────────────────────────
export * from './auth/auth.actions';
export * from './auth/auth.state';
export * from './auth/auth.guard';
export * from './auth/login-page.guard';
export * from './auth/auth.interceptor';
export * from './auth/auth-refresh.coordinator';
export * from './auth/cross-tab-auth-sync.service';
export * from './auth/login/login.component';

// ── Boot + configuration ─────────────────────────────────────────────────────
export * from './bootstrap/app-init.service';
export * from './config/config.service';
export * from './state/app-config.state';

// ── Cross-cutting services ───────────────────────────────────────────────────
export * from './errors/error-handler.service';
export * from './theme/theme.service';
export * from './services/user-preferences.service';
export * from './services/user-preferences.types';
export * from './sidebar/sidebar-state.service';
export * from './entity-search/entity-search.service';

// ── Navigation graph ─────────────────────────────────────────────────────────
export * from './navi-graph/navi-graph.service';
export * from './navi-graph/navi-graph.types';
export * from './navi-graph/component-registry';

// ── Section scoping ──────────────────────────────────────────────────────────
// The interceptor stamps `X-CoolMS-Section`; the port is how the app tells it
// which section is active without core naming a feature.
export * from './interceptors/section.interceptor';
export * from './section/current-section.port';

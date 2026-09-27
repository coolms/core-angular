# @coolms/core-angular

The CoolMS client runtime for Angular — everything a CoolMS front end needs
before it has any UI:

- **Session** — login, token refresh with a single-flight coordinator,
  cross-tab sync, route guards, and a sign-in page.
- **Boot and configuration** — the API manifest, app config state, and the
  `ConfigService` that reads layout/dialog/form/datagrid configuration.
- **Theme and user preferences** — one preference store (`coolms_ui_prefs`)
  covering grids, panels, page state, navigation and the terminal.
- **Cross-cutting** — the error handler, the auth and section HTTP
  interceptors, the navigation graph, and entity search.
- **Wire types** — the shapes the CoolMS API emits, including the
  `form-render` contract.

It is not admin-specific: nothing here is admin chrome. It is also not a
general-purpose Angular library — every endpoint it speaks is a CoolMS one, so
it is only useful against a CoolMS backend.

## Layering

The bottom of the CoolMS Angular packages: it has no `@coolms` peers of its own.
The UI kit (`@coolms/ui-angular`) and the feature packages -- the editors, the
viewers and the rest of `@coolms/*-angular` -- build on it; nothing here depends
on them.

The reason this is a package rather than application code is federation. The UI
kit and every federated remote need the session, config, error handling and
preferences **at runtime**, resolved to a single `singleton` instance — and a
remote cannot import from its host.

## Public surface

`src/public-api.ts` is the whole API. Nothing outside the package may deep-link
past it, and the consuming application enforces that with a lint rule, so the
barrel is a real contract rather than a convenience re-export. A symbol that is
not exported there is internal; exporting one is a deliberate decision about the
package API.

## Building

```
npm run build
```

Produces `dist/` — FESM 2022 bundles plus type definitions, compiled in Angular's
*partial* mode so the consuming application's own compiler finishes the job. That
is what keeps a build made with one Angular 22 release working in an application
on a later one within the peer range. `@angular/*`, `@ngxs/store` and `rxjs` stay external, as peers.

On its own -- a clone, or CI -- it installs its toolchain (`ng-packagr`, the
Angular compiler, TypeScript) from its committed lockfile, and that is how a
published build is made. Inside the CoolMS workspace its `node_modules` is instead
a relative symlink to the admin application's, so exactly one `@angular` tree is
in play while the admin consumes this package from source: a second copy would
give two type identities for the same class.

## Status

A pre-release: the shape is still moving and it carries no compatibility
promise. Published under the `alpha` dist-tag. Until a stable release exists, `latest`
points at the newest alpha as well -- npm set it on the first publish -- so a bare
`npm install @coolms/core-angular` gets a pre-release.

The CoolMS admin application consumes it from source via a TypeScript path
mapping rather than from the registry, so the published build and the one the
admin runs are produced the same way but resolved differently.

## Requirements

Angular (`common`, `core`, `forms`, `router`), NGXS and RxJS are peers; the supported ranges are declared in `package.json`, which is what an install actually checks.

## Licence

MIT — see [LICENSE](LICENSE).

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

```
@coolms/core-angular  ->  @coolms/admin-ui-angular  ->  @coolms/<module>-ui-angular
```

The naming rule: `-angular` is a library, `-ui-angular` ships components.

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
is what keeps a package built against 19.x working as an application moves
forward. `@angular/*`, `@ngxs/store` and `rxjs` stay external, as peers.

The build runs through the admin application's `ng-packagr`, because this package
deliberately installs **no toolchain and no framework of its own**: its
`node_modules` is a relative symlink to the admin's, so exactly one `@angular`
tree is ever in play. A second copy would give two type identities for the same
class while the package is consumed from source.

## Status

Consumed today from source, via a TypeScript path mapping in the CoolMS admin
application — the same way `@coolms/editor-angular` is.

Still marked `private`: the distributable builds, but publishing to npm is a
deliberate step that has not been taken. Clearing the flag is what enables
`npm publish dist`.

## Requirements

Angular, NGXS, RxJS and `@angular/cdk` are peers; the supported ranges are declared in `package.json`, which is what an install actually checks.

## Licence

MIT — see [LICENSE](LICENSE).

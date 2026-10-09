# Changelog

All notable changes to `@coolms/core-angular` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the version named below, which is what the registry
currently serves. Earlier alphas are deliberately not reconstructed: entries are written
in the same commit as the work they describe, and inventing the ones that
predate this file would be a worse record than not having them.

## 2.0.0-alpha.5 - 2026-10-09

### Changed

- **The elevation prompt opens only when a person asks for it.** A 403 that
  the server stamps `X-Elevation-Required` no longer opens the prompt by
  itself. `elevationInterceptor` now:
  - leaves a refused read (`GET`, `HEAD`, `OPTIONS`: a page loading, a poll)
    to its caller, which shows its own state;
  - leaves a refused background request alone (see `BACKGROUND_REQUEST`);
  - tells `ELEVATION_NOTICE` when a write a person made is refused, and hands
    the 403 back at once. The application shows the refusal with an Elevate
    button, and only that click opens the prompt (`ElevationService.offerFor`).
    The refused action is not repeated by itself.
- `ErrorHandlerService.humanize()` says "This needs an elevated session." for
  a stamped refusal, and "You don't have access to this." in place of the
  framework's bare "Access Denied." for any other 403. A sentence the server
  wrote for the refused action is kept.
- `ConfigService` no longer caches a failed read, so a page that was refused
  reads again after the person elevates.
- **The console opens for an account the server grants it to.** Once the
  session is settled, the auth guard asks for the admin's endpoint map: a 200
  merges it into the app config, and a 403 signs this sign-in out (on the
  server too) and returns to the sign-in page, which says the account has no
  access to the console. A failure to ask is not an answer: the console opens,
  and each of its requests is still decided by the server.
  - The map is read at `/api/v1/admin/manifest`, and at the older
    `/api/v1/console/manifest` only when the server answers 404 there.
  - An answer is kept only for the sign-in that asked. Nothing is asked while
    nobody is signed in.
  - A module route waits for the map when someone is signed in.
  - The realtime connection opens after this check, and a refused sign-in
    opens none.
- The sign-in page shows its answer (a wrong password, or the console's
  refusal) as soon as it arrives, without waiting for the person to type.

### Added

- `BACKGROUND_REQUEST`: an `HttpContextToken` marking a request no person
  made. The realtime connection and subscription tokens and the preferences
  sync carry it.
- `ELEVATION_NOTICE` and `ElevationNoticePort`: how an application is told
  that a person's write was refused for want of elevation.
- `isElevationRefusal(err)`: the one test for a stamped 403.
- `ConsoleAccessService` in the public API.

## 2.0.0-alpha.4 - 2026-09-27

### Changed

- `ElevationService`: an elevation whose `expiresAt` is already past is
  reported as expired **when its state is read** -- `state()` and
  `elevated()` are plain accessors that compare against the clock and demote
  the stored state on the spot -- rather than when a timer fires. A timer only
  reschedules the announcement; the read does the work, which is what a
  suspended tab, a moved clock or a missed tick could never defeat. The
  service also reconciles on `visibilitychange` and `focus`, coalesced to one
  refresh per two seconds.

### Added

- `ElevationService` and the rest of the elevation client in the public API:
  `elevationInterceptor`, `BYPASS_ELEVATION`, `ELEVATION_REQUIRED_HEADER`,
  `ELEVATION_PROMPT` and the three `ELEVATION_WARNING_*` reasons. 2.0.0-alpha.3
  did not export them, so a package importing `ElevationService` from the
  published build failed to compile (TS2305) -- the reason this release was cut.
  Measured on the bundles: 30 runtime exports in alpha.3, 51 here, none removed.
- `console@1`, the administration host contract (the platform rule: hosts implement contracts, modules offer entries):
  `ConsoleEntry` and the six lists a module contributes as data (`routes`,
  `bindings`, `topbar`, `overlays`, `panels`, `states`, `providers`),
  `consoleEntry()` for an entry file that exports one object and runs nothing,
  `assembleConsole()` which refuses a range this contract does not meet and
  every collision (a path, a binding name, a top-bar id, a port claimed by two
  modules) by name, and the host side a theme calls: `consoleChildren()` (one
  lazy child per mount, `canMatch` from the manifest), `provideConsole()` (the
  store with the host's and the modules' states, the registry bindings as an
  initializer, every provision), `ConsoleActivation` (what the backend's
  `ui.modules` says is installed: the tiles, overlays and panels to render,
  and the modules named but missing from the build), and `ConsolePanelHost`,
  the port a dock panel talks back through. `ApiManifest.ui` mirrors the
  backend's section. The mount's `canMatch` answers once `AppInitService`
  signals ready: the router recognises a pasted module URL while the
  initializer is still fetching the manifest, and a synchronous read there
  sent every cold deep link to the dashboard.
- Declares `bugs` so a page imported from this package, and the catalogue,
  know where a correction is filed. The registry filled the gap from GitHub when
  the manifest was silent; the declared field is the one that holds on any
  registry.

**`DocumentApiManifest` gained `spacesAvailableUrl` and `spaceEnablementUrl`.**
Optional, mirroring the backend manifest DTO. They let the Documents space
accordion offer an *Add space* control instead of only ever losing entries when
a site is not enabled for documents.

Both optional, so a client built against an older backend simply hides the
control rather than showing one that cannot work.

### Fixed

- The README named a package that does not exist (`@coolms/admin-ui-angular`),
  said the package installs no toolchain of its own (it does, from its lockfile,
  outside the workspace), said it was built against Angular 19 (it is built with
  22 and peers on ^22), listed `@angular/cdk` as a peer (it is not one), and said
  `latest` waits for a stable release (npm points it at the newest alpha).

## 2.0.0-alpha.3 -- 2026-09-03

**A pre-release, carrying no compatibility promise.** Published under the
`alpha` dist-tag.

The client runtime the other CoolMS Angular packages sit on: session and token
refresh with a single-flight coordinator, the boot manifest and application
config state, theme and user preferences, the error handler, the HTTP
interceptors, and the wire types the CoolMS API emits.

It is the bottom of the layer graph -- it has no `@coolms` peers of its own, and
no runtime dependencies at all. Angular, NGXS and RxJS are peers.

### Fixed

- The Status section told readers the package was not published to npm, which
  it served from its own npm page. It now states what does not change when a
  version is tagged.

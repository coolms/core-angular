# Changelog

All notable changes to `@coolms/core-angular` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the version named below, which is what the registry
currently serves. Earlier alphas are deliberately not reconstructed: entries are written
in the same commit as the work they describe, and inventing the ones that
predate this file would be a worse record than not having them.

## Unreleased

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
  backend's section.
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

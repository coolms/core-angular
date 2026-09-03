# Changelog

All notable changes to `@coolms/core-angular` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the version named below, which is what the registry
currently serves. Earlier alphas are deliberately not reconstructed: entries are written
in the same commit as the work they describe, and inventing the ones that
predate this file would be a worse record than not having them.

## 2.0.0-alpha.3 — 2026-09-03

**A pre-release, carrying no compatibility promise.** Published under the
`alpha` dist-tag.

The client runtime the other CoolMS Angular packages sit on: session and token
refresh with a single-flight coordinator, the boot manifest and application
config state, theme and user preferences, the error handler, the HTTP
interceptors, and the wire types the CoolMS API emits.

It is the bottom of the layer graph — it has no `@coolms` peers of its own, and
no runtime dependencies at all. Angular, NGXS and RxJS are peers.

### Fixed

- The Status section told readers the package was not published to npm, which
  it served from its own npm page. It now states what does not change when a
  version is tagged.

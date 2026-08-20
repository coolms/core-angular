import { InjectionToken } from '@angular/core';

/**
 * The one fact the section interceptor needs: which site the operator is
 * currently working in.
 *
 * `core` is auth, config, errors and interceptors -- the layer everything else
 * is built on -- so it must not import a feature. The obvious-looking fix,
 * moving `SectionState` into core, is the wrong one: sections are a CMS domain
 * concept, and hoisting domain state into the base layer trades one bad
 * direction for another. So core declares the little it needs and the module
 * that owns the state provides it, bound in the composition root.
 *
 * Read SYNCHRONOUSLY on purpose. An interceptor decides whether to stamp a
 * header while building the request; it cannot wait on a stream.
 */
export interface CurrentSectionPort {
    /** Slug of the active section, or null when the operator picked none. */
    currentSlug(): string | null;
}

/**
 * Optional by design: an application assembled without a Sections module binds
 * nothing and simply sends no `X-CoolMS-Section` header, which is exactly what
 * a single-site install wants.
 */
export const CURRENT_SECTION = new InjectionToken<CurrentSectionPort>(
    'coolms.current-section',
);

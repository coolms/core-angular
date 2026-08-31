import { inject } from '@angular/core';
import { type HttpInterceptorFn } from '@angular/common/http';
import { CURRENT_SECTION } from '../section/current-section.port';

/**
 * Phase H7 -- admin Site Selector.
 *
 * Stamps `X-CoolMS-Section: <slug>` on outgoing `/api/v1/*` requests when
 * the admin has picked a section from the Site Selector dropdown. The backend
 * honours it for AUTHENTICATED requests only -- anonymous traffic cannot pivot
 * the active section.
 *
 * What the header actually reaches, counted rather than intended: exactly two
 * readers act on it, `CreatePageProcessor` and `CreateCollectionProcessor`,
 * each choosing WHICH SITE a newly created page or collection lands in -- and,
 * for a page, that section's default locale and slug-naming policy. Nothing
 * else is scoped by it. Media spaces list every active section regardless, and
 * every other reader of `_coolms_section` sits on the public SSR surface,
 * which resolves from host+path and never sees this header.
 *
 * This block used to say the backend "scopes site-specific API providers
 * (pages, media spaces, etc.)". That described where Phase H was heading --
 * H4/H5, multisite Document and Media, never landed -- not what it does. Left
 * recorded because a docstring naming an intended destination reads exactly
 * like one naming a shipped feature, and this one misdescribed the control for
 * three months.
 *
 * Skipped:
 *  - non-API URLs (no section context needed for SSR/static)
 *  - `/auth/*` endpoints (login/refresh are pre-session; the header would
 *    be ignored by the backend anyway, but skipping keeps wire traffic clean)
 *  - requests that already carry the header (programmatic overrides win)
 */
export const sectionInterceptor: HttpInterceptorFn = (req, next) => {
    if (!shouldStamp(req.url)) {
        return next(req);
    }
    if (req.headers.has('X-CoolMS-Section')) {
        return next(req);
    }

    // Optional: no Sections module installed means no section to stamp.
    const slug = inject(CURRENT_SECTION, { optional: true })?.currentSlug() ?? null;
    if (!slug) return next(req);

    return next(req.clone({ setHeaders: { 'X-CoolMS-Section': slug } }));
};

function shouldStamp(url: string): boolean {
    // Strip protocol/host so absolute and relative URLs are treated alike.
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (!path.startsWith('/api/v1/')) return false;
    if (path.startsWith('/api/v1/auth/')) return false;
    return true;
}

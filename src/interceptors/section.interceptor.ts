import { inject } from '@angular/core';
import { type HttpInterceptorFn } from '@angular/common/http';
import { CURRENT_SECTION } from '../section/current-section.port';

/**
 * Phase H7 -- admin Site Selector.
 *
 * Stamps `X-CoolMS-Section: <slug>` on outgoing `/api/v1/*` requests when
 * the admin has picked a section from the Site Selector dropdown. The
 * backend honours the header for authenticated users and scopes
 * site-specific API providers (pages, media spaces, etc.) to the
 * selected site.
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

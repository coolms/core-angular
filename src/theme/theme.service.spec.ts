import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Store } from '@ngxs/store';

import { IdentityApiClient } from '../api/identity-api.client';
import { ThemeService } from './theme.service';

/**
 * The service's whole job is that `data-theme` on <html> ends up matching the
 * user's stored preference, so every assertion here reads the ATTRIBUTE rather
 * than the signal — a service that tracked the choice perfectly and never
 * touched the document would be useless and would still pass a signal-only test.
 */
describe('ThemeService', () => {
    const CACHE_KEY = 'coolms_theme';

    function setup(settings: unknown, opts: { fail?: boolean; platformAccent?: string | null } = {}) {
        const api = {
            getSettings: () => opts.fail
                ? throwError(() => new Error('401'))
                : of(settings as Record<string, Record<string, unknown>>),
        };
        const store = {
            selectSnapshot: () => ({
                platformDefaults: { accentColor: opts.platformAccent ?? null },
            }),
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                ThemeService,
                { provide: IdentityApiClient, useValue: api },
                { provide: Store, useValue: store },
            ],
        });

        return TestBed.inject(ThemeService);
    }

    const attr = () => document.documentElement.getAttribute('data-theme');

    const ACCENT_KEY = 'coolms_accent';

    beforeEach(() => {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(ACCENT_KEY);
        document.documentElement.style.removeProperty('--cms-accent');
    });

    afterEach(() => {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(ACCENT_KEY);
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.style.removeProperty('--cms-accent');
    });

    it('applies a stored dark preference to the document', () => {
        const svc = setup({ preferences: { theme: 'dark' } });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        expect(svc.choice()).toBe('dark');
        expect(svc.resolved()).toBe('dark');
        expect(attr()).toBe('dark');
    });

    it('applies a stored light preference even when the OS prefers dark', () => {
        const svc = setup({ preferences: { theme: 'light' } });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        // An explicit choice must beat the OS — that is what "light" MEANS,
        // as opposed to "system".
        expect(svc.resolved()).toBe('light');
        expect(attr()).toBe('light');
    });

    it('resolves `system` against the OS rather than picking a side', () => {
        const svc = setup({ preferences: { theme: 'system' } });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        const osDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        expect(svc.choice()).toBe('system');
        expect(svc.resolved()).toBe(osDark ? 'dark' : 'light');
        expect(attr()).toBe(osDark ? 'dark' : 'light');
    });

    it('caches the choice so the next load paints the right colour first', () => {
        const svc = setup({ preferences: { theme: 'dark' } });
        svc.ensureLoaded().subscribe();

        expect(localStorage.getItem(CACHE_KEY)).toBe('dark');

        // A fresh instance, before any request resolves, already knows.
        const next = setup({ preferences: { theme: 'dark' } });
        expect(next.choice()).toBe('dark');
        expect(next.resolved()).toBe('dark');
    });

    it('keeps the cached choice when the settings request fails', () => {
        localStorage.setItem(CACHE_KEY, 'dark');
        const svc = setup(null, { fail: true });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        // Anonymous users get a 401 here; falling back to light would flash the
        // login screen white for someone who chose dark.
        expect(svc.resolved()).toBe('dark');
        expect(attr()).toBe('dark');
    });

    it('ignores a malformed stored value instead of applying it', () => {
        const svc = setup({ preferences: { theme: 'neon' } });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        expect(svc.choice()).toBe('system');
    });

    it('re-themes when the Preferences tab saves', () => {
        const svc = setup({ preferences: { theme: 'light' } });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();
        expect(attr()).toBe('light');

        svc.update('dark');
        TestBed.flushEffects();
        expect(attr()).toBe('dark');

        // Other sections PATCH through the same handler and hand over a bag
        // with no `theme` key at all; that must not clear the choice.
        svc.update(undefined);
        TestBed.flushEffects();
        expect(attr()).toBe('dark');
    });

    it('applies a stored accent as an inline override on the document', () => {
        const svc = setup({ preferences: { theme: 'dark', accentColor: '#3366ff' } });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        expect(svc.accent()).toBe('#3366ff');
        // Inline, so it outranks the stylesheet in BOTH themes rather than
        // being overridden by the dark block.
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('#3366ff');
    });

    it('leaves the stylesheet accent alone when the user has no override', () => {
        const svc = setup({ preferences: { theme: 'dark', accentColor: null } });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        expect(svc.accent()).toBeNull();
        // Absent, NOT set-to-the-default: the deployment's colour must still
        // be able to show through.
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('');
    });

    it('refuses a stored accent that is not a plain hex colour', () => {
        // The value is substituted into a CSS custom property, so a stored
        // setting is untrusted input at the point of RENDER, not just on write.
        const svc = setup({ preferences: { accentColor: 'red; background: url(//evil)' } });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        expect(svc.accent()).toBeNull();
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('');
    });

    it('clears the accent when the user empties the field', () => {
        const svc = setup({ preferences: { accentColor: '#3366ff' } });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('#3366ff');

        svc.updateAccent(null);
        TestBed.flushEffects();
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('');

        // A malformed value must not blank a good one either.
        svc.updateAccent('#3366ff');
        TestBed.flushEffects();
        svc.updateAccent('nonsense');
        TestBed.flushEffects();
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('#3366ff');
    });

    it('falls back to the deployment accent when the user has none', () => {
        const svc = setup({ preferences: { accentColor: null } }, { platformAccent: '#0a7d2b' });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        expect(svc.userAccent()).toBeNull();
        expect(svc.platformAccent()).toBe('#0a7d2b');
        expect(svc.accent()).toBe('#0a7d2b');
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('#0a7d2b');
    });

    it('lets a personal accent beat the deployment one', () => {
        const svc = setup({ preferences: { accentColor: '#3366ff' } }, { platformAccent: '#0a7d2b' });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        expect(svc.accent()).toBe('#3366ff');
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('#3366ff');
    });

    it('returns to the deployment accent when the user clears theirs', () => {
        const svc = setup({ preferences: { accentColor: '#3366ff' } }, { platformAccent: '#0a7d2b' });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        svc.updateAccent(null);
        TestBed.flushEffects();

        // Clearing a personal colour must reveal the deployment's, not the
        // stylesheet's — the three rungs collapse in order.
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('#0a7d2b');
    });

    it('applies the deployment accent even when the settings request fails', () => {
        // An anonymous visitor on the login screen still gets the brand.
        const svc = setup(null, { fail: true, platformAccent: '#0a7d2b' });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('#0a7d2b');
    });

    it('ignores a malformed deployment accent', () => {
        const svc = setup({ preferences: {} }, { platformAccent: 'rebeccapurple' });
        svc.ensureLoaded().subscribe();
        TestBed.flushEffects();

        expect(svc.platformAccent()).toBeNull();
        expect(document.documentElement.style.getPropertyValue('--cms-accent')).toBe('');
    });

    it('loads the settings request only once', () => {
        let calls = 0;
        const api = { getSettings: () => { calls++; return of({ preferences: { theme: 'dark' } }); } };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                ThemeService,
                { provide: IdentityApiClient, useValue: api },
                { provide: Store, useValue: { selectSnapshot: () => ({}) } },
            ],
        });
        const svc = TestBed.inject(ThemeService);

        svc.ensureLoaded().subscribe();
        svc.ensureLoaded().subscribe();
        svc.ensureLoaded().subscribe();

        expect(calls).toBe(1);
    });
});

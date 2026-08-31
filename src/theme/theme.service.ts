import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { type Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { Store } from '@ngxs/store';

import { IdentityApiClient } from '../api/identity-api.client';
import { AppConfigState } from '../state/app-config.state';

/** What the user PICKED. `system` defers to the OS. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/** What that resolves to right now — the only two the stylesheet knows. */
export type ResolvedTheme = 'light' | 'dark';

const CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system'];

/**
 * A CACHE, never a source of truth.
 *
 * The authoritative value is `preferences.theme` in `/auth/me/settings`, which
 * the Profile → Preferences tab already writes. This copy exists only so the
 * first paint of a reload is the right colour: the settings request is async,
 * so without it every load would start light and flip. It is deliberately NOT
 * stored via UserPreferencesService, which syncs its own bag to the server —
 * that would give one setting two server-side homes.
 */
const CACHE_KEY = 'coolms_theme';
const ACCENT_CACHE_KEY = 'coolms_accent';

/**
 * Six-digit hex only, checked again HERE even though the server already vets it
 * on write. This value is substituted into a `--cms-*` custom property,
 * and a stored setting is data from the network like any other — the write-side
 * guard protects what the admin stores, this one protects what it renders.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

function isChoice(v: unknown): v is ThemeChoice {
    return typeof v === 'string' && (CHOICES as readonly string[]).includes(v);
}

function isAccent(v: unknown): v is string {
    return typeof v === 'string' && HEX.test(v);
}

/**
 * Applies the user's theme by setting `data-theme` on the document element.
 *
 * The stylesheet does the rest: `:root[data-theme='dark']` re-points the
 * `--cms-*` palette and every colour in the admin arrives through those names.
 * Nothing here knows a single colour, which is the point — a second
 * theme is a block of tokens, not a code change.
 *
 * Follows the shape of UserCalendarPreferencesService and
 * CallOverlayPreferencesService: lazy one-shot load of `/auth/me/settings`,
 * cached for the SPA lifetime, with `update()` called by the Profile page after
 * a save so the change lands without a refetch.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
    private readonly api = inject(IdentityApiClient);
    private readonly store = inject(Store);

    private readonly _choice = signal<ThemeChoice>(ThemeService.readCache());
    private readonly _systemDark = signal(false);
    private readonly _userAccent = signal<string | null>(ThemeService.readAccentCache());
    private readonly _platformAccent = signal<string | null>(null);

    private loadOnce$?: Observable<ThemeChoice>;

    /** The user's stored choice, including `system`. */
    readonly choice = this._choice.asReadonly();

    /** This user's personal override, independent of the deployment's. */
    readonly userAccent = this._userAccent.asReadonly();

    /** The deployment's brand accent from the API manifest, if it set one. */
    readonly platformAccent = this._platformAccent.asReadonly();

    /**
     * The colour actually painted: personal override, else the deployment's,
     * else null — which leaves the stylesheet's own accent in place.
     *
     * Three rungs and each is a real state. A user who has chosen nothing is
     * NOT the same as one who chose the deployment's colour: clear the
     * deployment's brand and the first user follows it, the second does not.
     */
    readonly accent = computed<string | null>(() => this._userAccent() ?? this._platformAccent());

    /** The choice with `system` resolved against the OS setting. */
    readonly resolved = computed<ResolvedTheme>(() => {
        const c = this._choice();

        return c === 'system' ? (this._systemDark() ? 'dark' : 'light') : c;
    });

    constructor() {
        // `matchMedia` is guarded because the unit suite and any SSR-ish
        // rendering path may not provide it; absent it, `system` means light.
        const mq = typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : null;

        if (mq) {
            this._systemDark.set(mq.matches);
            // The OS can flip while the SPA is open, and `system` must follow it
            // live rather than only at load.
            mq.addEventListener('change', e => this._systemDark.set(e.matches));
        }

        effect(() => this.applyToDocument(this.resolved()));
        effect(() => this.applyAccent(this.accent()));
    }

    /**
     * One-shot load of the stored preference. Safe to call more than once and
     * safe for anonymous users — a failure leaves the cached/system value in
     * place rather than forcing light, so the login screen still matches the OS.
     */
    ensureLoaded(): Observable<ThemeChoice> {
        if (this.loadOnce$) return this.loadOnce$;

        // Read the deployment's colour FIRST and synchronously, so it is in
        // place whether or not the settings request succeeds — an anonymous
        // visitor on the login screen still sees the deployment's brand.
        this.readPlatformAccent();

        this.loadOnce$ = this.api.getSettings().pipe(
            map(all => {
                const prefs = all['preferences'] as Record<string, unknown> | undefined;
                // The accent rides along on the same response — it is a field of
                // the same section, so it costs no extra request.
                this.setAccent(isAccent(prefs?.['accentColor']) ? prefs['accentColor'] : null);

                return isChoice(prefs?.['theme']) ? prefs['theme'] : this._choice();
            }),
            tap(choice => this.set(choice)),
            catchError(() => of(this._choice())),
            shareReplay({ bufferSize: 1, refCount: false }),
        );

        return this.loadOnce$;
    }

    /**
     * Called by the Profile page after the Preferences tab saves, so the admin
     * re-themes on the spot. Ignores anything that is not a known choice —
     * the section PATCH returns the whole merged bag, not just this field.
     */
    update(value: unknown): void {
        if (isChoice(value)) this.set(value);
    }

    /**
     * Companion to {@link update} for the accent field of the same save.
     * An explicit null clears the override; anything malformed is ignored
     * rather than applied, so a bad value can never blank the admin's accent.
     */
    updateAccent(value: unknown): void {
        if (null === value || '' === value) this.setAccent(null);
        else if (isAccent(value)) this.setAccent(value);
    }

    private set(choice: ThemeChoice): void {
        this._choice.set(choice);
        try {
            localStorage.setItem(CACHE_KEY, choice);
        } catch {
            // A blocked or full localStorage costs the pre-paint hint, nothing
            // more — the server value still arrives and applies.
        }
    }

    /**
     * The manifest is loaded at bootstrap, well before the authenticated shell
     * calls this, so a snapshot read is enough and no subscription is needed.
     * A malformed value is ignored rather than applied — the container refuses
     * to build with one, but the manifest crosses the network all the same.
     */
    private readPlatformAccent(): void {
        const value = this.store.selectSnapshot(AppConfigState.manifest)?.platformDefaults?.accentColor;
        this._platformAccent.set(isAccent(value) ? value : null);
    }

    private setAccent(accent: string | null): void {
        this._userAccent.set(accent);
        try {
            if (accent) localStorage.setItem(ACCENT_CACHE_KEY, accent);
            else localStorage.removeItem(ACCENT_CACHE_KEY);
        } catch {
            // Same as the theme cache: losing it costs the pre-paint hint only.
        }
    }

    /**
     * Writes the override onto the document element, where an inline style
     * outranks every stylesheet rule — including the dark block — so one
     * declaration re-points the accent in both themes.
     *
     * Only --cms-accent is set, not the -hover/-light/-text members of the
     * family. Deriving those from an arbitrary user colour needs a colour model
     * the palette does not have yet, and guessing them would produce hover
     * states that clash with the very colour the user chose. Until then the
     * override moves the brand fill and leaves its supporting tones alone.
     */
    private applyAccent(accent: string | null): void {
        const root = document.documentElement;
        if (accent && HEX.test(accent)) root.style.setProperty('--cms-accent', accent);
        else root.style.removeProperty('--cms-accent');
    }

    private applyToDocument(theme: ResolvedTheme): void {
        // Written for BOTH values rather than only removing the attribute for
        // light, so the attribute is a reliable signal for anything that wants
        // to read the active theme, and so a future `[data-theme='light']`
        // block has something to hang on.
        document.documentElement.setAttribute('data-theme', theme);
    }

    private static readCache(): ThemeChoice {
        try {
            const raw = localStorage.getItem(CACHE_KEY);

            return isChoice(raw) ? raw : 'system';
        } catch {
            return 'system';
        }
    }

    private static readAccentCache(): string | null {
        try {
            const raw = localStorage.getItem(ACCENT_CACHE_KEY);

            return isAccent(raw) ? raw : null;
        } catch {
            return null;
        }
    }
}

import type { EnvironmentProviders, InjectionToken, Provider, Type } from '@angular/core';
import type { Routes } from '@angular/router';

/**
 * `console` -- the administration host contract (the platform rule: hosts implement contracts, modules offer entries).
 *
 * A module contributes to the console with ONE object, its entry: data the
 * host reads, never a call the module makes into the host. Six lists, each
 * optional; an absent list means "nothing here", never an error. The host
 * assembles the entries (build time today, install time under federation),
 * refuses collisions by name, and activates only the modules the backend's
 * manifest says are installed.
 *
 * The version is MAJOR.MINOR: a minor adds an optional list or field, a major
 * changes or removes one. An entry declares the range it was written for
 * (`^1.2` -- major 1, minor at least 2), checked at build against this
 * constant and at install against the theme's declaration.
 */
export const CONSOLE_CONTRACT = { name: 'console', version: '1.0' } as const;

export interface ConsoleEntry {
    /** The backend module id, as `config/modules/<id>`. Activation is by this id. */
    readonly module: string;
    readonly contract: 'console';
    /** The console versions this entry was written for: a caret range over MAJOR.MINOR, e.g. '^1.0'. */
    readonly range: string;

    readonly routes?:    readonly ConsoleRouteMount[];
    readonly bindings?:  readonly ConsoleBinding[];
    readonly topbar?:    readonly ConsoleTopbarItem[];
    readonly overlays?:  readonly ConsoleOverlay[];
    readonly panels?:    readonly ConsolePanel[];
    readonly states?:    readonly Type<unknown>[];
    readonly providers?: readonly ConsoleProvision[];
}

/** What a route's `data` carries for the shell: the sidebar item to light, and whether the page owns its height. */
export interface ConsoleNavHint {
    readonly activeNav?: string;
    readonly fullHeight?: boolean;
    /** An intermediate crumb the top bar renders between Home and the page. */
    readonly breadcrumb?: { readonly label: string; readonly routerLink: string };
    /** Which server layout the page renders, for the generic layout pages. */
    readonly layoutId?: string;
}

/**
 * A route mounted under the console's authenticated layout. The host adds
 * what a module may not decide: the layout component, `canActivate: [authGuard]`,
 * and a `canMatch` that answers whether the module is installed here. Routes
 * are lazy: a static component here would put every module's pages in `main`.
 */
export type ConsoleRouteMount =
    | {
        readonly path: string;
        readonly children: () => Promise<Routes>;
        readonly nav?: ConsoleNavHint;
        readonly providers?: readonly Provider[];
    }
    | {
        readonly path: string;
        readonly component: () => Promise<Type<unknown>>;
        readonly nav?: ConsoleNavHint;
        readonly providers?: readonly Provider[];
    }
    | {
        readonly path: string;
        readonly redirectTo: string;
    };

/** A `ComponentRegistry` name -> class: names a module OWNS (its server layouts name them) and names it fills in another module's slot (`profile.tab:call`). */
export interface ConsoleBinding {
    readonly name: string;
    readonly component: Type<unknown>;
}

/** A tile in the top bar's quick-access strip, rendered in ascending `order`. */
export interface ConsoleTopbarItem {
    readonly id: string;
    readonly order: number;
    readonly component: Type<unknown>;
}

/** Mounted once, inside the authenticated layout, outside the router outlet. */
export interface ConsoleOverlay {
    readonly id: string;
    readonly component: Type<unknown>;
}

/**
 * A dock panel the layout opens and closes: the host renders its toggle in
 * the top bar and the panel in the dock, and the panel talks back through
 * {@link ConsolePanelHost} -- not through outputs, which a slot cannot carry.
 */
export interface ConsolePanel {
    readonly id: string;
    readonly dock: 'bottom';
    /** The top-bar toggle: a label (the title), an icon name or a short text, and a key the host binds with Ctrl. */
    readonly toggle: { readonly label: string; readonly icon?: string; readonly text?: string; readonly key?: string };
    readonly component: Type<unknown>;
}

/**
 * What a `provide*` line is: environment providers from a library's registry
 * (editor extensions, viewers, field widgets, file editors), or the
 * implementation of a single-implementation port, listed as such so the
 * assembly can refuse two modules implementing one port by name.
 */
export type ConsoleProvision =
    | EnvironmentProviders
    | Provider
    | ConsolePortProvision;

export interface ConsolePortProvision {
    readonly port: InjectionToken<unknown>;
    readonly useExisting: Type<unknown>;
}

export function isPortProvision(p: ConsoleProvision): p is ConsolePortProvision {
    return typeof p === 'object' && 'port' in p && 'useExisting' in p;
}

/** The identity function with the type: an entry file exports data, nothing runs. */
export function consoleEntry(entry: ConsoleEntry): ConsoleEntry {
    return entry;
}

/** MAJOR.MINOR, both non-negative integers. */
const VERSION = /^(\d+)\.(\d+)$/;
/** `^MAJOR.MINOR` -- the caret is required: an entry names what it needs, never a bare number. */
const RANGE = /^\^(\d+)\.(\d+)$/;

/**
 * Whether a caret range over MAJOR.MINOR admits a version: same major, minor
 * at least the range's. Malformed input admits nothing -- a range that cannot
 * be read must refuse, never pass.
 */
export function satisfiesRange(range: string, version: string): boolean {
    const r = RANGE.exec(range);
    const v = VERSION.exec(version);
    if (!r || !v) return false;
    return Number(r[1]) === Number(v[1]) && Number(v[2]) >= Number(r[2]);
}

/** The refusal an assembly raises: one message per collision, all of them, by name. */
export class ConsoleAssemblyError extends Error {
    constructor(readonly problems: readonly string[]) {
        super(`console assembly refused:\n  ${problems.join('\n  ')}`);
        this.name = 'ConsoleAssemblyError';
    }
}

/**
 * The checks every assembly runs, in one place so the build-time spec, the
 * bootstrap and a future install-time loader agree: entry ranges against
 * this contract, and the collision rules of the six lists. Returns the
 * entries unchanged when nothing is wrong.
 */
export function assembleConsole(entries: readonly ConsoleEntry[]): readonly ConsoleEntry[] {
    const problems: string[] = [];
    const seenModules = new Map<string, number>();
    const paths = new Map<string, string>();
    const bindings = new Map<string, string>();
    const topbar = new Map<string, string>();
    const overlays = new Map<string, string>();
    const panels = new Map<string, string>();
    const states = new Map<Type<unknown>, string>();
    const ports = new Map<InjectionToken<unknown>, string>();

    const claim = <K>(map: Map<K, string>, key: K, owner: string, what: string): void => {
        const prev = map.get(key);
        if (prev !== undefined && prev !== owner) {
            problems.push(`${what} '${String(key)}' is claimed by modules '${prev}' and '${owner}'`);
        } else {
            map.set(key, owner);
        }
    };

    for (const e of entries) {
        if (!satisfiesRange(e.range, CONSOLE_CONTRACT.version)) {
            problems.push(`module '${e.module}' offers console ${e.range}; this host implements console ${CONSOLE_CONTRACT.version} -- refused`);
        }
        seenModules.set(e.module, (seenModules.get(e.module) ?? 0) + 1);

        for (const r of e.routes ?? []) claim(paths, r.path, e.module, 'route path');
        for (const b of e.bindings ?? []) claim(bindings, b.name, e.module, 'binding');
        for (const t of e.topbar ?? []) claim(topbar, t.id, e.module, 'top-bar item');
        for (const o of e.overlays ?? []) claim(overlays, o.id, e.module, 'overlay');
        for (const p of e.panels ?? []) claim(panels, p.id, e.module, 'panel');
        for (const s of e.states ?? []) claim(states, s, e.module, 'state');
        for (const p of e.providers ?? []) {
            if (isPortProvision(p)) claim(ports, p.port, e.module, 'port');
        }
    }
    for (const [module, n] of seenModules) {
        if (n > 1) problems.push(`module '${module}' has ${n} entries; one entry per module`);
    }

    if (problems.length) throw new ConsoleAssemblyError(problems);
    return entries;
}

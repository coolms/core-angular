import {
    computed,
    inject,
    Injectable,
    InjectionToken,
    makeEnvironmentProviders,
    provideAppInitializer,
    type EnvironmentProviders,
    type Provider,
    type Type,
} from '@angular/core';
import type { CanMatchFn, Route, Routes } from '@angular/router';
import { provideStore, Store } from '@ngxs/store';
import type { ApiManifest } from '../../api/api-manifest.types';
import { ComponentRegistry } from '../../navi-graph/component-registry';
import { AppConfigState } from '../../state/app-config.state';
import {
    assembleConsole,
    CONSOLE_CONTRACT,
    isPortProvision,
    type ConsoleEntry,
    type ConsoleOverlay,
    type ConsolePanel,
    type ConsoleTopbarItem,
} from './console-v1';

/**
 * The host side of `console@1`: what a theme calls to turn the assembled
 * entries into routes, providers and the lists its shell renders.
 *
 * Activation is the backend's: `GET /app-config` carries `ui.modules`, the
 * modules whose console entry the installer matched against the theme's
 * declaration. A module in the bundle but not in that list is dormant -- no
 * route matches, no tile, no overlay; a module in the list but not in the
 * bundle is reported by name ({@link ConsoleActivation.missing}), never
 * silently absent.
 */

/** Every entry this build assembled, after {@link assembleConsole}'s checks. */
export const CONSOLE_ENTRIES = new InjectionToken<readonly ConsoleEntry[]>('coolms.console.entries');

/**
 * The port a dock panel talks back through: the layout provides one per
 * panel it mounts, so the panel never needs an output the slot cannot carry.
 */
export abstract class ConsolePanelHost {
    abstract close(): void;
    abstract maximize(on: boolean): void;
}

/** The console modules the manifest says are installed here. */
export function installedConsoleModules(manifest: ApiManifest | null): ReadonlySet<string> {
    return new Set(
        (manifest?.ui?.modules ?? [])
            .filter(m => m.contract === CONSOLE_CONTRACT.name)
            .map(m => m.module),
    );
}

@Injectable({ providedIn: 'root' })
export class ConsoleActivation {
    private readonly entries = inject(CONSOLE_ENTRIES, { optional: true }) ?? [];
    private readonly manifest = inject(Store).selectSignal(AppConfigState.manifest);

    readonly installed = computed(() => installedConsoleModules(this.manifest()));

    /** The entries of installed modules, in assembly order. */
    readonly active = computed(() => this.entries.filter(e => this.installed().has(e.module)));

    readonly topbar = computed<readonly ConsoleTopbarItem[]>(() =>
        this.active().flatMap(e => e.topbar ?? [])
            .slice()
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    );
    readonly overlays = computed<readonly ConsoleOverlay[]>(() => this.active().flatMap(e => e.overlays ?? []));
    readonly panels   = computed<readonly ConsolePanel[]>(() => this.active().flatMap(e => e.panels ?? []));

    /** Modules the manifest names that this build has no entry for: what a diagnostics page shows by name. */
    readonly missing = computed(() =>
        [...this.installed()].filter(m => !this.entries.some(e => e.module === m)).sort(),
    );

    isInstalled(module: string): boolean {
        return this.installed().has(module);
    }
}

/** `canMatch` for a module's mount: the route exists only where the module is installed. */
export function consoleModuleInstalled(module: string): CanMatchFn {
    return () => inject(ConsoleActivation).isInstalled(module);
}

/**
 * The children a theme mounts under its authenticated layout for the
 * assembled entries: one `Route` per mount, lazy as written, `data` from the
 * entry's nav hint, `canMatch` from the manifest. The theme keeps its own
 * shape around them (login, the layout, `canActivate: [authGuard]`, the
 * wildcard).
 */
export function consoleChildren(entries: readonly ConsoleEntry[]): Routes {
    const routes: Routes = [];
    for (const e of assembleConsole(entries)) {
        for (const m of e.routes ?? []) {
            if ('redirectTo' in m) {
                routes.push({ path: m.path, redirectTo: m.redirectTo, pathMatch: 'full' });
                continue;
            }
            const route: Route = {
                path: m.path,
                canMatch: [consoleModuleInstalled(e.module)],
                ...(m.nav ? { data: { ...m.nav } } : {}),
                ...(m.providers ? { providers: [...m.providers] } : {}),
            };
            if ('children' in m) {
                route.loadChildren = m.children;
            } else {
                route.loadComponent = m.component;
            }
            routes.push(route);
        }
    }
    return routes;
}

/**
 * The providers a theme adds for the assembled entries: the store with the
 * host's states and every module state, the registry bindings (an
 * initializer, so they exist before the first render), every module
 * provision, and {@link CONSOLE_ENTRIES} for the shell. Place it AFTER the
 * library providers a module's provisions extend (the editor bridge, the
 * PDF viewer), as the hand-written lines were.
 */
export function provideConsole(
    entries: readonly ConsoleEntry[],
    options: { readonly hostStates: readonly Type<unknown>[] },
): EnvironmentProviders {
    const checked = assembleConsole(entries);
    const providers: (Provider | EnvironmentProviders)[] = [
        { provide: CONSOLE_ENTRIES, useValue: checked },
        provideStore([...options.hostStates, ...checked.flatMap(e => e.states ?? [])]),
        provideAppInitializer(() => {
            const registry = inject(ComponentRegistry);
            for (const e of checked) {
                for (const b of e.bindings ?? []) registry.register(b.name, b.component);
            }
        }),
    ];
    for (const e of checked) {
        for (const p of e.providers ?? []) {
            providers.push(isPortProvision(p) ? { provide: p.port, useExisting: p.useExisting } : p);
        }
    }
    return makeEnvironmentProviders(providers);
}

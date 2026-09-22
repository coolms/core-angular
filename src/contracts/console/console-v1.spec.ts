import { ApplicationInitStatus, Component, InjectionToken, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Route } from '@angular/router';
import { Store } from '@ngxs/store';
import { firstValueFrom, of, ReplaySubject, type Observable } from 'rxjs';
import { AppInitService } from '../../bootstrap/app-init.service';

import { ComponentRegistry } from '../../navi-graph/component-registry';
import { consoleChildren, ConsoleActivation, CONSOLE_ENTRIES, provideConsole } from './console-host';
import { assembleConsole, ConsoleAssemblyError, CONSOLE_CONTRACT, consoleEntry, satisfiesRange } from './console-v1';

@Component({ selector: 'spec-a', standalone: true, template: 'a' })
class SpecA {}
@Component({ selector: 'spec-b', standalone: true, template: 'b' })
class SpecB {}

describe('console@1 -- ranges', () => {
 it('a caret range admits the same major at or above its minor, and nothing it cannot read', () => {
        expect(satisfiesRange('^1.0', '1.0')).toBeTrue();
        expect(satisfiesRange('^1.0', '1.4')).toBeTrue();
        expect(satisfiesRange('^1.2', '1.1')).withContext('a point added in 1.2 is missing on 1.1').toBeFalse();
        expect(satisfiesRange('^1.0', '2.0')).withContext('a major changes or removes points').toBeFalse();
        expect(satisfiesRange('1.0', '1.0')).withContext('no caret: an entry names what it needs').toBeFalse();
        expect(satisfiesRange('^1', '1.0')).withContext('no minor').toBeFalse();
        expect(satisfiesRange('^1.0', '1')).toBeFalse();
    });

 it('this host implements MAJOR.MINOR', () => {
        expect(CONSOLE_CONTRACT.name).toBe('console');
        expect(CONSOLE_CONTRACT.version).toMatch(/^\d+\.\d+$/);
    });
});

describe('console@1 -- assembly refuses by name', () => {
    const PORT = new InjectionToken<unknown>('spec.port');
    const base = { contract: 'console' as const, range: '^1.0' };

 it('passes entries that collide on nothing', () => {
        const entries = [
            consoleEntry({ ...base, module: 'a', routes: [{ path: 'a', component: () => Promise.resolve(SpecA) }], bindings: [{ name: 'A', component: SpecA }] }),
            consoleEntry({ ...base, module: 'b', routes: [{ path: 'b', component: () => Promise.resolve(SpecB) }], bindings: [{ name: 'B', component: SpecB }] }),
        ];
        expect(assembleConsole(entries)).toBe(entries);
    });

 it('names both modules for every collision, and the module whose range this host does not meet', () => {
        const entries = [
            consoleEntry({ ...base, module: 'a',
                routes:    [{ path: 'shared', component: () => Promise.resolve(SpecA) }],
                bindings:  [{ name: 'Same', component: SpecA }],
                topbar:    [{ id: 'tile', order: 1, component: SpecA }],
                providers: [{ port: PORT, useExisting: SpecA }],
            }),
            consoleEntry({ ...base, module: 'b', range: '^2.0',
                routes:    [{ path: 'shared', children: () => Promise.resolve([]) }],
                bindings:  [{ name: 'Same', component: SpecB }],
                topbar:    [{ id: 'tile', order: 2, component: SpecB }],
                providers: [{ port: PORT, useExisting: SpecB }],
            }),
        ];
        let error: ConsoleAssemblyError | undefined;
        try { assembleConsole(entries); } catch (e) { error = e as ConsoleAssemblyError; }

        expect(error).toBeInstanceOf(ConsoleAssemblyError);
        const problems = error!.problems;
        expect(problems).toContain(`module 'b' offers console ^2.0; this host implements console ${CONSOLE_CONTRACT.version} -- refused`);
        expect(problems).toContain(`route path 'shared' is claimed by modules 'a' and 'b'`);
        expect(problems).toContain(`binding 'Same' is claimed by modules 'a' and 'b'`);
        expect(problems).toContain(`top-bar item 'tile' is claimed by modules 'a' and 'b'`);
        expect(problems.some(p => p.startsWith(`port 'InjectionToken spec.port' is claimed by modules 'a' and 'b'`))).toBeTrue();
        expect(problems.length).toBe(5);
    });

 it('refuses two entries for one module', () => {
        expect(() => assembleConsole([consoleEntry({ ...base, module: 'a' }), consoleEntry({ ...base, module: 'a' })]))
            .toThrowError(ConsoleAssemblyError, /module 'a' has 2 entries/);
    });
});

describe('console@1 -- the host side', () => {
    const entries = [
        consoleEntry({ contract: 'console', range: '^1.0', module: 'installed',
            routes:   [{ path: 'inst', component: () => Promise.resolve(SpecA), nav: { activeNav: '/inst', fullHeight: true } }, { path: 'old', redirectTo: 'inst' }],
            bindings: [{ name: 'Installed', component: SpecA }],
            topbar:   [{ id: 'installed.tile', order: 20, component: SpecA }],
            overlays: [{ id: 'installed.overlay', component: SpecA }],
        }),
        consoleEntry({ contract: 'console', range: '^1.0', module: 'dormant',
            routes:   [{ path: 'dorm', children: () => Promise.resolve([]) }],
            topbar:   [{ id: 'dormant.tile', order: 10, component: SpecB }],
            panels:   [{ id: 'dormant.panel', dock: 'bottom', toggle: { icon: 'x', label: 'X' }, component: SpecB }],
        }),
    ];
    const MANIFEST = { apiBase: '/api/v1', ui: { contracts: { console: '1.0' }, modules: [
        { module: 'installed', contract: 'console', range: '^1.0', framework: 'angular' },
        { module: 'absent',    contract: 'console', range: '^1.0', framework: 'angular' },
    ] } };

    // A real signal for the manifest and a subject for ready$: the cold-load
    // spec below sets the one and fires the other in the order the app does.
    let manifest: WritableSignal<typeof MANIFEST | null>;
    let ready: ReplaySubject<void>;

    beforeEach(() => {
        manifest = signal<typeof MANIFEST | null>(MANIFEST);
        ready = new ReplaySubject<void>(1);
        ready.next();
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                { provide: Store, useValue: { selectSignal: () => manifest, selectSnapshot: () => manifest(), select: () => of(manifest()) } },
                { provide: AppInitService, useValue: { ready$: ready.asObservable() } },
                { provide: CONSOLE_ENTRIES, useValue: entries },
            ],
        });
    });

    const askGuard = (route: Route): Promise<boolean> =>
        firstValueFrom(TestBed.runInInjectionContext(() => (route.canMatch![0] as () => Observable<boolean>)()));

 it('activates by the manifest: the installed module renders, the dormant one does not, the absent one is named', () => {
        const activation = TestBed.inject(ConsoleActivation);
        expect([...activation.installed()].sort()).toEqual(['absent', 'installed']);
        expect(activation.topbar().map(t => t.id)).toEqual(['installed.tile']);
        expect(activation.overlays().map(o => o.id)).toEqual(['installed.overlay']);
        expect(activation.panels()).toEqual([]);
        expect(activation.missing()).toEqual(['absent']);
    });

 it('mounts each route lazily with its nav hint as data and the module as its canMatch', async () => {
        const routes = consoleChildren(entries);
        expect(routes.map(r => r.path)).toEqual(['inst', 'old', 'dorm']);
        expect(routes[0].data).toEqual({ activeNav: '/inst', fullHeight: true });
        expect(routes[0].loadComponent).toBeDefined();
        expect(routes[1].redirectTo).toBe('inst');
        expect(routes[2].loadChildren).toBeDefined();
        expect(routes[2].canMatch?.length).toBe(1);
 // The guard, asked inside the injector: yes for the installed module, no for the dormant one.
        expect(await askGuard(routes[0])).toBeTrue();
        expect(await askGuard(routes[2])).toBeFalse();
    });

 // A pasted module URL: the router asks canMatch while the initializer is
 // still fetching the manifest. The guard must hold its answer until the
 // manifest is in, and then answer from it -- a synchronous read here said
 // "no" for every module and every deep link landed on the dashboard.
 it('a cold deep link waits for the manifest instead of answering from an empty store', async () => {
        manifest.set(null);
        ready = new ReplaySubject<void>(1);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                { provide: Store, useValue: { selectSignal: () => manifest, selectSnapshot: () => manifest(), select: () => of(manifest()) } },
                { provide: AppInitService, useValue: { ready$: ready.asObservable() } },
                { provide: CONSOLE_ENTRIES, useValue: entries },
            ],
        });
        const routes = consoleChildren(entries);
        let answered: boolean | undefined;
        const pending = askGuard(routes[0]).then(v => { answered = v; return v; });
        await Promise.resolve();
        expect(answered).toBeUndefined();
 // The initializer lands the config, then signals ready -- the app's order.
        manifest.set(MANIFEST);
        ready.next();
        expect(await pending).toBeTrue();
    });

 it('provideConsole binds every entry`s names into the registry', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                provideConsole(entries, { hostStates: [] }),
            ],
        });
 // Initializers run when the application injector is created; the TestBed
 // runs them on first injection of ApplicationInitStatus.
        await TestBed.inject(ApplicationInitStatus).donePromise;
        expect(TestBed.inject(ComponentRegistry).get('Installed')).toBe(SpecA);
    });
});

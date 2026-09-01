import { Injectable, type Type } from '@angular/core';

/**
 * Registry mapping string keys to Angular component classes.
 *
 * Backed by a static Map so components registered at module load time
 * (e.g. in app.config.ts) are visible to all injected instances.
 *
 * Usage — static (app.config.ts / bootstrap time):
 *   ComponentRegistry.register('MediaLibraryPage', MediaLibraryPage);
 *
 * Usage — injected (SlotComponent / runtime):
 *   private readonly registry = inject(ComponentRegistry);
 *   const cls = this.registry.get('MediaLibraryPage');
 */
@Injectable({ providedIn: 'root' })
export class ComponentRegistry {
    private static readonly map = new Map<string, Type<unknown>>();

    // -- Static API (bootstrap / app.config.ts) -------------------------------

    static register(key: string, component: Type<unknown>): void {
        ComponentRegistry.map.set(key, component);
    }

    static get(key: string): Type<unknown> | undefined {
        return ComponentRegistry.map.get(key);
    }

    static has(key: string): boolean {
        return ComponentRegistry.map.has(key);
    }

    static keys(): string[] {
        return Array.from(ComponentRegistry.map.keys());
    }

    // -- Instance API (injectable) ---------------------------------------------

    register(key: string, component: Type<unknown>): void {
        ComponentRegistry.register(key, component);
    }

    get(key: string): Type<unknown> | null {
        return ComponentRegistry.get(key) ?? null;
    }

    has(key: string): boolean {
        return ComponentRegistry.has(key);
    }

    keys(): string[] {
        return ComponentRegistry.keys();
    }
}

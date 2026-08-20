import { Injectable, signal } from '@angular/core';

/**
 * Sidebar collapse state -- two independent dimensions:
 *
 *  - `collapsed`: whole-sidebar icon-only rail toggle (the chevron at
 *    the bottom of the sidebar). Per-device localStorage.
 *  - `collapsedSections`: per-section collapse, keyed by the section
 *    separator's node id. Used to fold a section's items under their
 *    header so the nav doesn't endless-scroll once a tenant has lots
 *    of modules. Per-device localStorage.
 *  - `collapsedItems`: per-item inline-expand collapse, keyed by the
 *    nav node's id. Mirrors `collapsedSections` but for sub-tree items
 *    (a top-level item with children, e.g. Reports -> Process Report).
 *    Absent id = expanded (children visible); present = collapsed.
 *    Per-device localStorage.
 *
 * Storage failures (private mode, quota, disabled cookies) fall back
 * to defaulting un-collapsed -- the toggles still work for the session,
 * just don't persist.
 */
@Injectable({ providedIn: 'root' })
export class SidebarStateService {
    private static readonly STORAGE_KEY          = 'coolms.admin.sidebar.collapsed';
    private static readonly STORAGE_KEY_SECTIONS = 'coolms.admin.sidebar.collapsedSections';
    private static readonly STORAGE_KEY_ITEMS    = 'coolms.admin.sidebar.collapsedItems';

    readonly collapsed         = signal<boolean>(this.readPersisted());
    readonly collapsedSections = signal<Set<string>>(this.readSectionsPersisted());
    readonly collapsedItems    = signal<Set<string>>(this.readItemsPersisted());

    toggle(): void {
        const next = !this.collapsed();
        this.collapsed.set(next);
        this.persist(next);
    }

    isSectionCollapsed(id: string): boolean {
        return this.collapsedSections().has(id);
    }

    toggleSection(id: string): void {
        const next = new Set(this.collapsedSections());
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        this.collapsedSections.set(next);
        this.persistSections(next);
    }

    /**
     * Force a section to be expanded. Used when navigation lands on
     * a route inside a manually-collapsed section -- it would be
     * confusing to leave the active item hidden. The user can
     * collapse the section again afterwards.
     */
    ensureExpanded(id: string): void {
        if (!this.collapsedSections().has(id)) return;
        const next = new Set(this.collapsedSections());
        next.delete(id);
        this.collapsedSections.set(next);
        this.persistSections(next);
    }

    // ─── Per-item inline-expand (sub-tree items, e.g. a section's children) ──

    isItemCollapsed(id: string): boolean {
        return this.collapsedItems().has(id);
    }

    toggleItem(id: string): void {
        const next = new Set(this.collapsedItems());
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        this.collapsedItems.set(next);
        this.persistItems(next);
    }

    private readPersisted(): boolean {
        try {
            return localStorage.getItem(SidebarStateService.STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    }

    private persist(value: boolean): void {
        try {
            localStorage.setItem(SidebarStateService.STORAGE_KEY, String(value));
        } catch {
            // Non-persistence acceptable; toggle still works in-session.
        }
    }

    private readSectionsPersisted(): Set<string> {
        try {
            const raw = localStorage.getItem(SidebarStateService.STORAGE_KEY_SECTIONS);
            if (raw === null) return new Set();
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) return new Set();
            return new Set(parsed.filter((v): v is string => typeof v === 'string'));
        } catch {
            return new Set();
        }
    }

    private persistSections(value: Set<string>): void {
        try {
            localStorage.setItem(
                SidebarStateService.STORAGE_KEY_SECTIONS,
                JSON.stringify(Array.from(value)),
            );
        } catch {
            // Non-persistence acceptable; toggle still works in-session.
        }
    }

    private readItemsPersisted(): Set<string> {
        try {
            const raw = localStorage.getItem(SidebarStateService.STORAGE_KEY_ITEMS);
            if (raw === null) return new Set();
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) return new Set();
            return new Set(parsed.filter((v): v is string => typeof v === 'string'));
        } catch {
            return new Set();
        }
    }

    private persistItems(value: Set<string>): void {
        try {
            localStorage.setItem(
                SidebarStateService.STORAGE_KEY_ITEMS,
                JSON.stringify(Array.from(value)),
            );
        } catch {
            // Non-persistence acceptable; toggle still works in-session.
        }
    }
}

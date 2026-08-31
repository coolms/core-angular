import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { catchError, map, type Observable, of } from 'rxjs';
import { Logout } from '../auth/auth.actions';
import { type NaviGraphNode, type NaviGraphNodeFlat } from './navi-graph.types';
import { ErrorHandlerService } from '../errors/error-handler.service';

/**
 * Loads, caches, and drives admin NaviGraph trees.
 *
 * Usage:
 *   naviGraphService.loadAdminNav(url).subscribe();
 *   const items = naviGraphService.adminNav();         // signal<NaviGraphNode[]>
 *   naviGraphService.handleClick(node);
 */
@Injectable({ providedIn: 'root' })
export class NaviGraphService {
    private readonly http   = inject(HttpClient);
    private readonly router = inject(Router);
    private readonly store  = inject(Store);
    private readonly errors = inject(ErrorHandlerService);

    /** Resolved root nodes for navi.admin (sidebar). */
    readonly adminNav  = signal<NaviGraphNode[]>([]);

    /** Resolved root nodes for navi.admin.topbar. */
    readonly topbarNav = signal<NaviGraphNode[]>([]);

    private readonly cache = new Map<string, NaviGraphNode[]>();

    // -------------------------------------------------------------------------

    loadAdminNav(url: string): Observable<NaviGraphNode[]> {
        return this.loadTree(url).pipe(
            map(tree => { this.adminNav.set(tree); return tree; }),
        );
    }

    loadTopbarNav(url: string): Observable<NaviGraphNode[]> {
        return this.loadTree(url).pipe(
            map(tree => { this.topbarNav.set(tree); return tree; }),
        );
    }

    // -------------------------------------------------------------------------

    /**
     * Handle a nav-node click.
     *
     * Routing logic based on meta.target:
     *   'action.logout'  — dispatch Logout
     *   '_blank'         — window.open (uses node.path as href)
     *   default          — router.navigate with meta.routerLink or node.path
     */
    handleClick(node: NaviGraphNode): void {
        const target = node.meta.target;

        if (target === 'action.logout') {
            this.store.dispatch(new Logout()).subscribe(() => {
                void this.router.navigate(['/login']);
            });
            return;
        }

        if (target === '_blank') {
            window.open(node.meta.routerLink ?? node.path, '_blank', 'noopener');
            return;
        }

        const link = node.meta.routerLink ?? node.path;
        void this.router.navigate([link]);
    }

    // -------------------------------------------------------------------------

    /**
     * Evaluate `showWhen` meta condition against a record.
     * Nodes with no `showWhen` are always visible.
     * Supports nested AND/OR logic: { and: [...] } / { or: [...] }
     */
    isVisible(node: NaviGraphNode, record: Record<string, unknown>): boolean {
        const showWhen = node.meta['showWhen'] as Record<string, unknown> | undefined;
        if (!showWhen) return true;
        return this.evalCondition(showWhen, record);
    }

    /**
     * Standalone `showWhen` evaluator for callers that don't have a
     * full `NaviGraphNode` (e.g. a grid's row context menu — a
     * `rowAction.showWhen` predicate is evaluated against the row's
     * own projection). `null`/`undefined` predicates default to
     * visible, mirroring `isVisible`'s "no rule = always shown"
     * semantics.
     */
    matchesShowWhen(showWhen: Record<string, unknown> | undefined | null, record: Record<string, unknown>): boolean {
        if (!showWhen) return true;
        return this.evalCondition(showWhen, record);
    }

    private evalCondition(cond: Record<string, unknown>, record: Record<string, unknown>): boolean {
        if ('and' in cond) {
            return (cond['and'] as Record<string, unknown>[])
                .every(c => this.evalCondition(c, record));
        }
        if ('or' in cond) {
            return (cond['or'] as Record<string, unknown>[])
                .some(c => this.evalCondition(c, record));
        }
        // Strict missing-field semantics. A leaf predicate
        // referencing a field absent from the record evaluates to
        // false (fail-loud) instead of the prior op-dependent lax
        // behavior that returned true for ne/nin/unknown ops. Aligns
        // with CSS attribute selectors / JSONPath / React conditional
        // rendering conventions.
        const field = cond['field'] as string;
        if (!(field in record)) return false;
        const val = record[field];
        switch (cond['op']) {
            case 'eq':  return val === cond['value'];
            case 'ne':  return val !== cond['value'];
            case 'in':  return Array.isArray(cond['value']) && (cond['value'] as unknown[]).includes(val);
            case 'nin': return Array.isArray(cond['value']) && !(cond['value'] as unknown[]).includes(val);
            // Prefix match for strings — primary use case is filtering
            // actions by MIME-type major (e.g., "image/" matches all
            // image MIMEs without enumerating each subtype).
            case 'startsWith':
                return typeof val === 'string'
                    && typeof cond['value'] === 'string'
                    && val.startsWith(cond['value']);
            // Strict: unknown / typo op (e.g. 'equals' instead of 'eq')
            // never matches.
            default:    return false;
        }
    }

    /**
     * Fetch a graph endpoint and return a nested tree.
     * Handles both compact JSON-LD IRIs (`member`) and
     * the legacy Hydra key (`hydra:member`).
     * Results are cached by URL for the lifetime of the service instance.
     */
    loadTree(url: string): Observable<NaviGraphNode[]> {
        if (this.cache.has(url)) {
            return of(this.cache.get(url)!);
        }

        return this.http.get<Record<string, unknown>>(url, {
            headers: { Accept: 'application/ld+json' },
        }).pipe(
            map(r => {
                const raw = r['member'] ?? r['hydra:member'] ?? [];
                const flat: NaviGraphNodeFlat[] = Array.isArray(raw) ? raw as NaviGraphNodeFlat[] : [];
                const tree = this.buildTree(flat);
                this.cache.set(url, tree);
                return tree;
            }),
            catchError(err => {
                console.error('[NaviGraph] loadTree failed for', url, this.errors.humanize(err));
                return of([]);
            }),
        );
    }

    /**
     * Build a nested tree from a flat array of nodes.
     * Nodes are sorted by sortOrder at each level.
     */
    private buildTree(flat: NaviGraphNodeFlat[]): NaviGraphNode[] {
        if (!flat.length) {
            return [];
        }

        const map = new Map<string, NaviGraphNode>(
            flat.map(n => [n.id, { ...n, children: [] }]),
        );
        const roots: NaviGraphNode[] = [];

        for (const node of map.values()) {
            if (node.parentId && map.has(node.parentId)) {
                map.get(node.parentId)!.children.push(node);
            } else {
                roots.push(node);
            }
        }

        const sort = (nodes: NaviGraphNode[]): void => {
            nodes.sort((a, b) => a.sortOrder - b.sortOrder);
            nodes.forEach(n => n.children?.length && sort(n.children));
        };
        sort(roots);

        return roots;
    }
}

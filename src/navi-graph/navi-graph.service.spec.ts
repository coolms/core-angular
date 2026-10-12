import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NaviGraphService } from './navi-graph.service';
import { NaviGraphNode, naviAccessOf } from './navi-graph.types';
import { ErrorHandlerService } from '../errors/error-handler.service';

/**
 * Jasmine specs for `NaviGraphService.isVisible` showWhen evaluator.
 *
 * Pins the evaluator contract: strict missing-field semantics.
 *
 * The 10 cases below mirror the ADR's implementation-phase test list.
 */

/** Build a minimal NaviGraphNode with the given showWhen meta. */
function nodeWith(showWhen: Record<string, unknown> | undefined): NaviGraphNode {
    return {
        id: 'n1',
        path: '/test',
        title: 'Test',
        parentId: null,
        sortOrder: 0,
        isActive: true,
        isVisible: true,
        meta: showWhen === undefined ? {} : { showWhen },
        children: [],
    } as NaviGraphNode;
}

describe('NaviGraphService.isVisible (showWhen evaluator — strict)', () => {
    let svc: NaviGraphService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                // Stub the injected deps -- isVisible is pure, doesn't touch them.
                { provide: HttpClient, useValue: {} },
                { provide: Router, useValue: {} },
                { provide: Store, useValue: { dispatch: () => ({ subscribe: () => undefined }) } },
                { provide: ErrorHandlerService, useValue: { humanize: (e: unknown) => String(e) } },
            ],
        });
        svc = TestBed.inject(NaviGraphService);
    });

    // 1. No showWhen -> always visible
    it('returns true when node has no showWhen meta', () => {
        const node = nodeWith(undefined);
        expect(svc.isVisible(node, { anything: 'goes' })).toBe(true);
    });

    // 2. eq op, field present, matches
    it('returns true for eq when field present and equal', () => {
        const node = nodeWith({ field: '_kind', op: 'eq', value: 'asset' });
        expect(svc.isVisible(node, { _kind: 'asset' })).toBe(true);
    });

    // 3. eq op, field present, mismatch
    it('returns false for eq when field present but not equal', () => {
        const node = nodeWith({ field: '_kind', op: 'eq', value: 'asset' });
        expect(svc.isVisible(node, { _kind: 'collection' })).toBe(false);
    });

    // 4. eq op, field missing -> STRICT: false
    it('returns false for eq when field is missing from record', () => {
        const node = nodeWith({ field: '_kind', op: 'eq', value: 'asset' });
        expect(svc.isVisible(node, { _surface: 'context' })).toBe(false);
    });

    // 5. ne op, field missing -> STRICT: false (lax used to return true)
    it('returns false for ne when field is missing from record (strict flip)', () => {
        const node = nodeWith({ field: 'isSystem', op: 'ne', value: true });
        expect(svc.isVisible(node, { _kind: 'asset' })).toBe(false);
    });

    // 6. ne op, field present, not equal
    it('returns true for ne when field present and not equal', () => {
        const node = nodeWith({ field: 'isSystem', op: 'ne', value: true });
        expect(svc.isVisible(node, { isSystem: false })).toBe(true);
    });

    // 7. in op, field missing -> false
    it('returns false for in when field is missing', () => {
        const node = nodeWith({ field: 'type', op: 'in', value: ['file', 'directory'] });
        expect(svc.isVisible(node, {})).toBe(false);
    });

    // 8. Unknown op (typo) -> STRICT: false (lax used to return true via default branch)
    it('returns false for unknown op (defensive against typos — strict flip)', () => {
        const node = nodeWith({ field: '_kind', op: 'equals', value: 'asset' });
        expect(svc.isVisible(node, { _kind: 'asset' })).toBe(false);
    });

    // 9. AND composition with one missing field -> false
    it('AND with missing field in one branch returns false', () => {
        const node = nodeWith({
            and: [
                { field: '_kind', op: 'eq', value: 'asset' },
                { field: '_single', op: 'eq', value: true },
            ],
        });
        expect(svc.isVisible(node, { _kind: 'asset' })).toBe(false);
    });

    // 10. OR composition with one missing field, other match -> true
    it('OR with missing field in one branch but match in the other returns true', () => {
        const node = nodeWith({
            or: [
                { field: 'mimeType', op: 'startsWith', value: 'image/' },
                { field: '_surface', op: 'eq', value: 'context' },
            ],
        });
        // mimeType missing -> first branch false; _surface present + matches -> second branch true.
        expect(svc.isVisible(node, { _surface: 'context' })).toBe(true);
    });
});

/**
 * The admin navigation is the server's answer per account AND per elevation state: a node is 'elevate' before a
 * grant and 'allowed' after it. The service caches a tree by URL, so a change of elevation must be able to re-ask,
 * and the node's access must reach the signal as the server sent it.
 */
describe('NaviGraphService.loadAdminNav (the server answer, cached or asked again)', () => {
    const URL = '/api/v1/navi/trees/navi.admin/graph';
    let svc: NaviGraphService;
    let http: HttpTestingController;

    const flat = (access?: 'allowed' | 'elevate'): Record<string, unknown> => ({
        member: [{
            id: 'b', path: '/backups', title: 'Backups', parentId: null, sortOrder: 0,
            isActive: true, isVisible: true, meta: { resource: '/api/v1/backup' },
            ...(access === undefined ? {} : { access }),
        }],
    });

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Router, useValue: {} },
                { provide: Store, useValue: { dispatch: () => ({ subscribe: () => undefined }) } },
                { provide: ErrorHandlerService, useValue: { humanize: (e: unknown) => String(e) } },
            ],
        });
        svc = TestBed.inject(NaviGraphService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('answers a second load from its cache, and asks the server again when told fresh', () => {
        svc.loadAdminNav(URL).subscribe();
        http.expectOne(URL).flush(flat('elevate'));
        expect(svc.adminNav()[0].access).toBe('elevate');

        svc.loadAdminNav(URL).subscribe();
        http.expectNone(URL);

        svc.loadAdminNav(URL, { fresh: true }).subscribe();
        http.expectOne(URL).flush(flat('allowed'));
        expect(svc.adminNav()[0].access).toBe('allowed');
    });

    it('keeps the tree it showed, and its cache, when a fresh re-ask fails', () => {
        svc.loadAdminNav(URL).subscribe();
        http.expectOne(URL).flush(flat('elevate'));
        const shown = svc.adminNav();
        expect(shown[0].access).toBe('elevate');

        svc.loadAdminNav(URL, { fresh: true }).subscribe();
        http.expectOne(URL).flush('down', { status: 502, statusText: 'Bad Gateway' });
        expect(svc.adminNav()).withContext('the sidebar is not emptied').toEqual(shown);

        svc.loadAdminNav(URL).subscribe();
        http.expectNone(URL);
        expect(svc.adminNav()).withContext('the cache still answers').toEqual(shown);
    });

    it('falls back to empty only for a tree that was never answered', () => {
        svc.loadAdminNav(URL).subscribe();
        http.expectOne(URL).flush('down', { status: 502, statusText: 'Bad Gateway' });
        expect(svc.adminNav()).toEqual([]);
    });

    it('reads an absent access as allowed, and only "elevate" as locked', () => {
        expect(naviAccessOf({})).toBe('allowed');
        expect(naviAccessOf({ access: 'allowed' })).toBe('allowed');
        expect(naviAccessOf({ access: 'elevate' })).toBe('elevate');
        expect(naviAccessOf({ access: 'something-else' as 'allowed' })).toBe('allowed');
    });
});

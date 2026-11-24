import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { NaviGraphService } from './navi-graph.service';
import { ErrorHandlerService } from '../errors/error-handler.service';
import table from './conditions.contract.json';

/**
 * The shared condition cases (design-tokens' contract/conditions.json, the pinned copy beside this file): every case
 * is evaluated by the service's own evaluator, unchanged, and must answer as the table says. The backend's mirror and
 * the workspace api-client run the same file, so the three never differ on a case.
 */
interface ConditionCase {
    readonly name: string;
    readonly condition: Record<string, unknown>;
    readonly record: Record<string, unknown>;
    readonly holds: boolean;
}

describe('NaviGraphService: the shared condition cases', () => {
    let svc: NaviGraphService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                // The evaluator is pure: the service's other dependencies are stubs.
                { provide: HttpClient, useValue: {} },
                { provide: Router, useValue: {} },
                { provide: Store, useValue: {} },
                { provide: ErrorHandlerService, useValue: {} },
            ],
        });
        svc = TestBed.inject(NaviGraphService);
    });

    const cases = (table as { cases: ConditionCase[] }).cases;

    it('the table is read and not empty', () => {
        expect(cases.length).toBeGreaterThan(30);
    });

    for (const c of cases) {
        it(c.name, () => {
            expect(svc.matchesShowWhen(c.condition, c.record)).toBe(c.holds);
        });
    }
});

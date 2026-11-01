import { HttpErrorResponse } from '@angular/common/http';
import { audienceRefusalOf } from './audience-refusal';

/**
 * A refusal of entry by audience is read from the problem's `type` alone, on a 403: never from its detail, never on
 * another status, and never from anything that is not an HTTP error.
 */
describe('audienceRefusalOf', () => {
    const problem = (status: number, type: unknown): HttpErrorResponse =>
        new HttpErrorResponse({ status, error: { type, title: 't', status, detail: 'd' } });

    it('reads each of the two types', () => {
        expect(audienceRefusalOf(problem(403, '/errors/identity/audience-not-granted'))).toBe('not-granted');
        expect(audienceRefusalOf(problem(403, '/errors/identity/audience-required'))).toBe('required');
    });

    it('is no refusal by audience on another type, another status, or no body', () => {
        expect(audienceRefusalOf(problem(403, '/errors/403'))).toBeNull();
        expect(audienceRefusalOf(problem(401, '/errors/identity/audience-required'))).toBeNull();
        expect(audienceRefusalOf(new HttpErrorResponse({ status: 403 }))).toBeNull();
        expect(audienceRefusalOf(new Error('/errors/identity/audience-required'))).toBeNull();
    });
});

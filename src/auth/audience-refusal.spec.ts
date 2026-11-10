import { HttpErrorResponse } from '@angular/common/http';
import { audienceRefusalOf, sessionEndsOn, WRONG_INTERFACE } from './audience-refusal';

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

    it('is no refusal by audience for a token sent to the other interface', () => {
        expect(audienceRefusalOf(problem(403, WRONG_INTERFACE))).toBeNull();
    });
});

/**
 * A session probe refused: a 403 ends the session only as a refusal of entry by audience; a token for the other
 * interface, or any other 403, keeps it. Every other refusal goes on to refresh as before.
 */
describe('sessionEndsOn', () => {
    const problem = (status: number, type: unknown): HttpErrorResponse =>
        new HttpErrorResponse({ status, error: { type, title: 't', status, detail: 'd' } });

    it('never on a 403 wrong-interface, nor on any other 403', () => {
        expect(sessionEndsOn(problem(403, WRONG_INTERFACE))).toBeFalse();
        expect(sessionEndsOn(problem(403, '/errors/403'))).toBeFalse();
        expect(sessionEndsOn(new HttpErrorResponse({ status: 403 }))).toBeFalse();
    });

    it('on a 403 audience-not-granted or audience-required, and on a 401 or a failure to ask', () => {
        expect(sessionEndsOn(problem(403, '/errors/identity/audience-not-granted'))).toBeTrue();
        expect(sessionEndsOn(problem(403, '/errors/identity/audience-required'))).toBeTrue();
        expect(sessionEndsOn(problem(401, '/errors/identity/invalid-token'))).toBeTrue();
        expect(sessionEndsOn(new HttpErrorResponse({ status: 0 }))).toBeTrue();
    });
});

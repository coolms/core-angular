import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ErrorHandlerService } from './error-handler.service';
import { SOMETHING_WENT_WRONG } from './problem-words';

/**
 * What a person reads for a failure anywhere in the admin: the server's sentence only when it declared the problem,
 * the one generic sentence otherwise, never a wording of the status.
 */
describe('ErrorHandlerService.humanize', () => {
    const errors = new ErrorHandlerService();

    const failure = (status: number, error: unknown, headers = new HttpHeaders()): HttpErrorResponse =>
        new HttpErrorResponse({ status, statusText: 'x', error, headers });

    it('says a declared refusal\'s sentence, an elevation refusal\'s included', () => {
        expect(errors.humanize(failure(403, {
            type: '/errors/elevation-required',
            detail: 'This needs an elevated session. Elevate, then try again.',
        }, new HttpHeaders({ 'X-Elevation-Required': 'identity.administrator_role' }))))
            .toBe('This needs an elevated session. Elevate, then try again.');
        expect(errors.humanize(failure(403, { type: '/errors/elevation/wrong-password', detail: 'Wrong password.' })))
            .toBe('Wrong password.');
        expect(errors.humanize(failure(429, { type: '/errors/too-many-attempts', detail: 'Too many attempts.' })))
            .toBe('Too many attempts.');
    });

    it('says the generic sentence for an undeclared problem, whatever its status and detail', () => {
        for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
            expect(errors.humanize(failure(status, { type: 'about:blank', title: 'x', status }))).toBe(SOMETHING_WENT_WRONG);
            expect(errors.humanize(failure(status, { detail: 'Access Denied.' }))).toBe(SOMETHING_WENT_WRONG);
            expect(errors.humanize(failure(status, { 'hydra:description': 'Said by the framework.', message: 'Internal.' })))
                .toBe(SOMETHING_WENT_WRONG);
        }
    });

    it('says the generic sentence for a network failure and for a thrown error, never its own text', () => {
        expect(errors.humanize(failure(0, new ProgressEvent('error')))).toBe(SOMETHING_WENT_WRONG);
        expect(errors.humanize(new Error('Cannot read properties of undefined'))).toBe(SOMETHING_WENT_WRONG);
        expect(errors.humanize(null)).toBe(SOMETHING_WENT_WRONG);
    });

    it('says only the first field message of a validation refusal', () => {
        expect(errors.humanize(failure(422, {
            type: 'about:blank',
            violations: [{ propertyPath: 'a', message: 'First.' }, { propertyPath: 'b', message: 'Second.' }],
        }))).toBe('First.');
    });
});

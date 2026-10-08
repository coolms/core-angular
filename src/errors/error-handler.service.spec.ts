import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ErrorHandlerService } from './error-handler.service';

/**
 * What a person reads for a refusal: the server's own sentence when it wrote one, and never the
 * framework's bare "Access Denied.", which the elevation dialog must not show.
 */
describe('ErrorHandlerService.humanize', () => {
    const errors = new ErrorHandlerService();

    const refusal = (detail: string | null, stamped: boolean): HttpErrorResponse => new HttpErrorResponse({
        status: 403,
        statusText: 'Forbidden',
        error: detail === null ? null : { detail },
        headers: stamped ? new HttpHeaders({ 'X-Elevation-Required': 'identity.administrator_role' }) : new HttpHeaders(),
    });

    it('says a refusal for want of elevation needs an elevated session, not "Access Denied."', () => {
        expect(errors.humanize(refusal('Access Denied.', true))).toBe('This needs an elevated session.');
        expect(errors.humanize(refusal(null, true))).toBe('This needs an elevated session.');
    });

    it('replaces the framework\'s refusal for any other 403 as well', () => {
        expect(errors.humanize(refusal('Access Denied.', false))).toBe('You don\'t have access to this.');
        expect(errors.humanize(refusal('  access denied  ', false))).toBe('You don\'t have access to this.');
    });

    it('keeps a sentence the server wrote for the refused action', () => {
        expect(errors.humanize(refusal("Permission denied: cannot write '/docs/a.md'", true)))
            .toBe("Permission denied: cannot write '/docs/a.md'");
    });
});

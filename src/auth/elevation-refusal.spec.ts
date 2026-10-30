import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ELEVATION_REQUIRED_HEADER, ELEVATION_REQUIRED_PROBLEM_TYPE, isElevationRefusal } from './elevation.service';

/**
 * A refusal for want of elevation is recognised by its problem type or by the
 * header, each alone: a reload, a bookmark or the back button reads the same
 * answer as a click does. Any other 403, and any other status, is not one.
 */
describe('isElevationRefusal', () => {
    const refusal = (status: number, body: unknown, header?: string) => new HttpErrorResponse({
        status,
        error: body,
        headers: header ? new HttpHeaders({ [ELEVATION_REQUIRED_HEADER]: header }) : new HttpHeaders(),
    });
    const typed = { type: ELEVATION_REQUIRED_PROBLEM_TYPE, status: 403, elevationGate: 'identity.administrator_role' };

    it('reads the problem type alone', () => {
        expect(isElevationRefusal(refusal(403, typed))).toBe(true);
    });

    it('reads the header alone', () => {
        expect(isElevationRefusal(refusal(403, { detail: 'Access Denied.' }, 'identity.administrator_role'))).toBe(true);
    });

    it('is no refusal for another 403', () => {
        expect(isElevationRefusal(refusal(403, { type: '/errors/403', detail: 'Access Denied.' }))).toBe(false);
        expect(isElevationRefusal(refusal(403, null))).toBe(false);
        expect(isElevationRefusal(refusal(403, 'Forbidden'))).toBe(false);
    });

    it('is no refusal for another status, whatever its body says', () => {
        expect(isElevationRefusal(refusal(401, typed))).toBe(false);
        expect(isElevationRefusal(refusal(500, typed, 'identity.administrator_role'))).toBe(false);
    });

    it('is no refusal for something that is not an HTTP error', () => {
        expect(isElevationRefusal(typed)).toBe(false);
        expect(isElevationRefusal(null)).toBe(false);
    });
});

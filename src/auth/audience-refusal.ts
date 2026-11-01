import { HttpErrorResponse } from '@angular/common/http';

/** The account may not enter this interface (not a member of its group). Not a fault: an answer. */
export const AUDIENCE_NOT_GRANTED = '/errors/identity/audience-not-granted';

/** The sign-in names no interface (a token from before audiences): signing in again mends it. */
export const AUDIENCE_REQUIRED = '/errors/identity/audience-required';

export type AudienceRefusal = 'not-granted' | 'required';

/**
 * Which refusal of entry by audience an error is, or null for any other error. Read from the problem's `type` alone
 * (403, `application/problem+json`): its `detail` is for logs, and says another interface's name as readily as this
 * one's. The server answers neither while entry by audience is not checked.
 */
export function audienceRefusalOf(error: unknown): AudienceRefusal | null {
    if (!(error instanceof HttpErrorResponse) || 403 !== error.status) {
        return null;
    }
    const body: unknown = error.error;
    const type = body !== null && typeof body === 'object' ? (body as { type?: unknown }).type : undefined;
    if (AUDIENCE_NOT_GRANTED === type) {
        return 'not-granted';
    }
    return AUDIENCE_REQUIRED === type ? 'required' : null;
}

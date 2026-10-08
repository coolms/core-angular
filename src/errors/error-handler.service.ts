import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ELEVATION_REQUIRED_HEADER } from '../auth/elevation.service';

/** The refusal text the server's framework writes when no one wrote a better one. */
const FRAMEWORK_REFUSAL = /^\s*access denied\.?\s*$/i;

/**
 * Converts any caught error into a human-readable message.
 *
 * Priority order for backend errors:
 *   1. error.detail              (RFC 7807 problem detail)
 *   2. error['hydra:description'] (Hydra validation errors)
 *   3. error.message             (generic)
 *   4. error.violations[]        (constraint violations)
 *   5. Status-based fallback
 */
@Injectable({ providedIn: 'root' })
export class ErrorHandlerService {
    humanize(err: unknown): string {
        if (!(err instanceof HttpErrorResponse)) {
            return err instanceof Error ? err.message : 'An unexpected error occurred.';
        }

        const elevationRefusal = err.status === 403 && !!err.headers?.get(ELEVATION_REQUIRED_HEADER);
        const body = err.error as Record<string, unknown> | null;
        if (body && typeof body === 'object') {
            const detail = body['detail'] ?? body['hydra:description'] ?? body['message'];
            // The framework's own refusal text ("Access Denied.") says nothing a person can act
            // on, so it is replaced by the status sentence; a sentence the server wrote for the
            // refused action ("Permission denied: cannot write '/docs/a'") is kept.
            if (typeof detail === 'string' && detail.trim() && !FRAMEWORK_REFUSAL.test(detail)) {
                return detail.trim();
            }

            if (Array.isArray(body['violations'])) {
                const msgs = (body['violations'] as Array<{ message: string }>)
                    .map(v => v.message)
                    .filter(Boolean);
                if (msgs.length) return msgs.join(' ');
            }
        }

        return elevationRefusal ? 'This needs an elevated session.' : this.statusMessage(err.status);
    }

    private statusMessage(status: number): string {
        switch (status) {
            case 0:   return 'Network error. Check your connection.';
            case 400: return 'Invalid request.';
            case 401: return 'Session expired. Please sign in again.';
            case 403: return 'You don\'t have access to this.';
            case 404: return 'Resource not found.';
            case 409: return 'Conflict — resource already exists.';
            case 422: return 'Validation failed.';
            case 429: return 'Too many requests. Please wait a moment.';
            case 500: return 'Server error. Please try again later.';
            case 503: return 'Service unavailable. Please try again later.';
            default:  return `Unexpected error (${status}).`;
        }
    }
}

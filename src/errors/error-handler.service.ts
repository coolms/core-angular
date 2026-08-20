import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

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

        const body = err.error as Record<string, unknown> | null;
        if (body && typeof body === 'object') {
            const detail = body['detail'] ?? body['hydra:description'] ?? body['message'];
            if (typeof detail === 'string' && detail.trim()) {
                return detail.trim();
            }

            if (Array.isArray(body['violations'])) {
                const msgs = (body['violations'] as Array<{ message: string }>)
                    .map(v => v.message)
                    .filter(Boolean);
                if (msgs.length) return msgs.join(' ');
            }
        }

        return this.statusMessage(err.status);
    }

    private statusMessage(status: number): string {
        switch (status) {
            case 0:   return 'Network error. Check your connection.';
            case 400: return 'Invalid request.';
            case 401: return 'Session expired. Please sign in again.';
            case 403: return 'Access denied.';
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

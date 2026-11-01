import { InjectionToken } from '@angular/core';

/**
 * The application a sign-in is for -- `admin`, `workspace` -- named by the application that provides it. A sign-in
 * sends it, and the tokens it gets back carry it; a refresh keeps it. The server can then let a token into the
 * surfaces of its own application only.
 *
 * None by default: an application that provides none signs in as before, naming no audience.
 */
export const AUTH_AUDIENCE = new InjectionToken<string | null>('coolms.auth.audience', {
    providedIn: 'root',
    factory: () => null,
});

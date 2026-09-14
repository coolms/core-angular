import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ElevationState } from './elevation.types';

/**
 * What the elevation prompt is told when it opens.
 *
 * `state` is the server's answer at the moment of asking -- `ended.reason` is
 * rendered first (ADR-184 s.8: a person asked for a password again after F5
 * with no explanation reads it as a fault), `warnings` may say the
 * installation cannot elevate yet, `mfaRequired` decides whether a code field
 * shows from the start.
 *
 * `refusal` is the server's own sentence for the action that was refused
 * ("Permission denied: cannot write '/docs/...'"), when a 403 opened the
 * prompt; absent when a disabled control offered elevation instead.
 */
export interface ElevationPromptRequest {
    state:    ElevationState;
    refusal?: string;
}

/**
 * The prompt itself is a dialog, and dialogs are the kit's -- a layer above
 * this one. Core owns the state, the interceptor and the decision to ask; the
 * application binds this port to whatever renders the question. Same shape as
 * `CURRENT_SECTION`: core declares the little it needs, the composition root
 * provides it.
 *
 * Resolves to true when the session is elevated by the time the dialog closes,
 * false when the person declined or could not. The port does not retry the
 * refused action; the interceptor does, on true.
 */
export interface ElevationPromptPort {
    open(request: ElevationPromptRequest): Observable<boolean>;
}

/**
 * Optional by design: with nothing bound, a 403 stays a 403 and the state
 * service still answers -- an application without an admin panel has no
 * prompt to show and loses nothing.
 */
export const ELEVATION_PROMPT = new InjectionToken<ElevationPromptPort>(
    'coolms.elevation-prompt',
);

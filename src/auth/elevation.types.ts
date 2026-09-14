/**
 * The elevation state of the signed-in session (ADR-184): the wire shape of
 * `GET /auth/elevation`, returned again by `POST` on a grant.
 *
 * Elevation is state, not a role. It lasts a fixed time from the grant, ends
 * when the admin panel is closed or reloaded, and the client derives nothing
 * about it from mode bits or membership: this record and the node resource's
 * capability flags are the two readings of ONE server-side decision, and the
 * client keeps no third.
 */
export interface ElevationState {
    /** Whether this session is elevated right now. */
    elevated: boolean;
    /** When the current elevation ends (ISO 8601); absent or null when not elevated. */
    expiresAt?: string | null;
    /** When the current elevation was granted (ISO 8601); absent or null when not elevated. */
    grantedAt?: string | null;
    /** How the LAST elevation of this session ended. Rendered by the prompt before it asks. */
    ended: ElevationEnded;
    /** The lifetime a grant made now would get, in seconds (the setting, clamped to the ceiling). */
    lifetimeSeconds: number;
    /** The most any elevation can last, fixed in code. */
    lifetimeCeilingSeconds: number;
    /** Whether the CURRENT elevation was confirmed by a second factor; absent or null when not elevated. */
    factorConfirmed?: boolean | null;
    /** Whether a grant made now must carry a code from the admin authenticator. */
    mfaRequired: boolean;
    /** What the prompt shows before asking; two of the codes mean the installation cannot elevate yet. */
    warnings: ElevationWarning[];
}

/**
 * `closed` is the beacon (the panel was closed or reloaded), `dropped_by_user`
 * the explicit drop, `refresh_from_other_pair` the tripwire of ADR-184 s.6,
 * `never` a session that has not elevated yet.
 */
export type ElevationEndedReason =
    | 'expired'
    | 'closed'
    | 'dropped_by_user'
    | 'refresh_from_other_pair'
    | 'never';

export interface ElevationEnded {
    reason: ElevationEndedReason;
    /** ISO 8601, null for `never`. */
    at: string | null;
}

/**
 * `elevation.password_not_set` and `elevation.factor_missing` mean the
 * installation cannot elevate and the message names the server command;
 * `elevation.mfa_off` is the recommendation carried while the switch is off.
 */
export interface ElevationWarning {
    /** The three the server documents today; the client renders any it does not know as text. */
    code: string;
    message: string;
}

export const ELEVATION_WARNING_PASSWORD_NOT_SET = 'elevation.password_not_set';
export const ELEVATION_WARNING_FACTOR_MISSING   = 'elevation.factor_missing';
export const ELEVATION_WARNING_MFA_OFF          = 'elevation.mfa_off';

/** Why the elevation of a session changed, for whoever refetches on it. */
export type ElevationChangeKind = 'granted' | 'dropped' | 'expired' | 'observed';

export interface ElevationChange {
    kind: ElevationChangeKind;
    state: ElevationState;
}

/** The two reasons the client sends when it drops an elevation itself. */
export type ElevationDropReason = 'dropped_by_user' | 'closed';

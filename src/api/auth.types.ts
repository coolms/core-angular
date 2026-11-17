import type { DataGridPreferences } from '../services/user-preferences.types';

/**
 * Session and current-user DTOs.
 *
 * They live in core because core runs the session: the NGXS auth state, the
 * refresh coordinator and the cross-tab sync are all here, and all three name
 * these shapes, so core needs no import of the admin's `ApiService` to read them.
 *
 * `ApiService` re-exports them from its own module, so the feature files that
 * import `UserDto` from there are untouched.
 */
export interface TokenResponse {
    accessToken:  string;
    refreshToken: string;
    expiresAt:    string;
    user?:        UserDto;
}

export interface UserDto {
    id:          string;
    email:       string;       // legacy field name kept for compatibility
    identifier?: string;       // actual API field (primary identifier value)
    roles:       string[];
    uiPrefs?:    DataGridPreferences;
    avatarUrl?:  string | null;
    firstName?:  string | null;
    lastName?:   string | null;
    fullName?:   string;
}

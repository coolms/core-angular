import { type TokenResponse, type UserDto } from '../api/auth.types';

export class Login {
    static readonly type = '[Auth] Login';
    constructor(public identifier: string, public password: string) {}
}

export class Logout {
    static readonly type = '[Auth] Logout';
}

export class RestoreSession {
    static readonly type = '[Auth] Restore Session';
}

export class SetTokens {
    static readonly type = '[Auth] Set Tokens';
    constructor(public readonly response: TokenResponse) {}
}

/** Merge a partial update into the currently-stored user (e.g. after avatar change). */
export class PatchCurrentUser {
    static readonly type = '[Auth] Patch Current User';
    constructor(public readonly patch: Partial<UserDto>) {}
}

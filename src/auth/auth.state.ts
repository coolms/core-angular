import { Injectable } from '@angular/core';
import { State, Action, Selector } from '@ngxs/store';
import type { StateContext } from '@ngxs/store';
import { catchError, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { IdentityApiClient } from '../api/identity-api.client';
import type { TokenResponse, UserDto } from '../api/auth.types';
import { Login, Logout, PatchCurrentUser, RestoreSession, SetTokens } from './auth.actions';
import { UserPreferencesService } from '../services/user-preferences.service';

export interface AuthStateModel {
    accessToken:  string | null;
    refreshToken: string | null;
    expiresAt:    string | null;
    user:         UserDto | null;
}

const STORAGE_KEY = 'coolms_token';

@State<AuthStateModel>({
    name: 'auth',
    defaults: { accessToken: null, refreshToken: null, expiresAt: null, user: null },
})
@Injectable()
export class AuthState {
    constructor(
        private api:   IdentityApiClient,
        private prefs: UserPreferencesService,
    ) {}

    @Action(Login)
    login(ctx: StateContext<AuthStateModel>, { identifier, password }: Login) {
        return this.api.login(identifier, password).pipe(
            tap((res: TokenResponse) => {
                const state: AuthStateModel = {
                    accessToken:  res.accessToken,
                    refreshToken: res.refreshToken,
                    expiresAt:    res.expiresAt,
                    user:         res.user ?? null,
                };
                ctx.setState(state);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            }),
            // Fetch full user data (includes uiPrefs) to seed preferences
            switchMap(() => this.api.me().pipe(catchError(() => of(null)))),
            tap(me => {
                if (!me) return;
                // Update stored user with full data including uiPrefs
                const updated = { ...ctx.getState(), user: me };
                ctx.setState(updated);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                if (me.uiPrefs) {
                    this.prefs.loadFromServer(me.uiPrefs);
                }
            }),
        );
    }

    @Action(Logout)
    logout(ctx: StateContext<AuthStateModel>) {
        ctx.setState({ accessToken: null, refreshToken: null, expiresAt: null, user: null });
        localStorage.removeItem(STORAGE_KEY);
    }

    @Action(RestoreSession)
    restore(ctx: StateContext<AuthStateModel>) {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        try {
            const state = JSON.parse(raw) as AuthStateModel;
            // Restore whenever any token is present.
            // If only the access token has expired but the refresh token is still
            // valid, the HTTP interceptor will transparently refresh on the next
            // request.  Discarding state here would throw away the refresh token
            // and force a full re-login unnecessarily.
            if (state.accessToken || state.refreshToken) {
                ctx.setState(state);
                // Seed preferences from previously stored user (covers page-reload case)
                if (state.user?.uiPrefs) {
                    this.prefs.loadFromServer(state.user.uiPrefs);
                }
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    @Action(SetTokens)
    setTokens(ctx: StateContext<AuthStateModel>, { response }: SetTokens): void {
        const state: AuthStateModel = {
            accessToken:  response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt:    response.expiresAt,
            user:         response.user ?? ctx.getState().user,
        };
        ctx.setState(state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    @Action(PatchCurrentUser)
    patchCurrentUser(ctx: StateContext<AuthStateModel>, { patch }: PatchCurrentUser): void {
        const current = ctx.getState();
        if (!current.user) return;
        const updated = { ...current, user: { ...current.user, ...patch } };
        ctx.setState(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }

    @Selector()
    static isAuthenticated(state: AuthStateModel): boolean {
        return null !== state.accessToken;
    }

    @Selector()
    static accessToken(state: AuthStateModel): string | null {
        return state.accessToken;
    }

    @Selector()
    static refreshToken(state: AuthStateModel): string | null {
        return state.refreshToken;
    }

    /**
     * Sub-phase Y -- expose the access-token expiry timestamp so
     * preemptive-refresh callers (e.g., Centrifuge getToken
     * callbacks) can decide whether to rotate before issuing the
     * next protected request, instead of relying on the
     * interceptor's reactive 401-retry path.
     */
    @Selector()
    static expiresAt(state: AuthStateModel): string | null {
        return state.expiresAt;
    }

    @Selector()
    static currentUser(state: AuthStateModel): UserDto | null {
        return state.user;
    }
}

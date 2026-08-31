import { Injectable } from '@angular/core';
import { State, Action, Selector } from '@ngxs/store';
import type { StateContext } from '@ngxs/store';
import { type ApiManifest, type ThemeConfigResponse, type ViewerApiManifest } from '../api/api-manifest.types';

// ─── Action ──────────────────────────────────────────────────────────────────

export class SetAppConfig {
    static readonly type = '[AppConfig] Set';
    constructor(public readonly config: ThemeConfigResponse) {}
}

// ─── State ───────────────────────────────────────────────────────────────────

export interface AppConfigStateModel {
    config:  ThemeConfigResponse | null;
    loaded:  boolean;
}

@State<AppConfigStateModel>({
    name: 'appConfig',
    defaults: { config: null, loaded: false },
})
@Injectable()
export class AppConfigState {

    @Action(SetAppConfig)
    set(ctx: StateContext<AppConfigStateModel>, { config }: SetAppConfig): void {
        ctx.setState({ config, loaded: true });
    }

    @Selector()
    static manifest(state: AppConfigStateModel): ApiManifest | null {
        return state.config?.manifest ?? null;
    }

    /**
     * F.7 viewer manifest. Null when the backend didn't ship a viewers
     * section (no tagged providers); consumers should fall back to a
     * "no preview" surface.
     */
    @Selector()
    static viewers(state: AppConfigStateModel): ViewerApiManifest | null {
        return state.config?.manifest.viewers ?? null;
    }

    @Selector()
    static loaded(state: AppConfigStateModel): boolean {
        return state.loaded;
    }
}

import { InjectionToken } from '@angular/core';

/**
 * Told when the server refused to store the person's interface preferences (a 422): the application shows the
 * sentence to the person, in its own toast or notice. `sentence` is whole, ready to show:
 * "Your preferences could not be saved: <the server's reason>".
 */
export interface PreferencesNoticePort {
    refused(sentence: string): void;
}

/** Optional: with nothing bound, a refusal is only written to the console. */
export const PREFERENCES_NOTICE = new InjectionToken<PreferencesNoticePort>('coolms.preferences-notice');

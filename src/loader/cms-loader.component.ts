import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The platform's loading indicator: the spinner of the UI contract's state component (`state` in design-tokens'
 * components.json), drawn from the tokens -- an arc turning on its track.
 *
 * One spinner for every wait, the same one the state component turns, so a page does not show two kinds of
 * waiting. A whole read waiting in place of its content is the state component's
 * (`cms-state kind="loading"`, which also waits its delay before it shows); this is for the waits inside a row, a
 * status bar or a button, and for a cover over content not ready to be seen.
 *
 * ## Why one component rather than a snippet per surface
 *
 * It is meant for every wait long enough to notice: a dashboard assembling its
 * cards, an editor paginating a document, an explorer listing a folder. Those
 * are different teams' files, and a copied indicator in each is how three
 * loaders that no longer match each other happen.
 *
 * Under `prefers-reduced-motion` it holds still and only breathes, because
 * motion sickness is not a stylistic preference.
 */
@Component({
    selector: 'cms-loader',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="cms-loader"
             [class.cms-loader--overlay]="overlay()"
             [class.cms-loader--inline]="inline()"
             role="status"
             [attr.aria-label]="label() || 'Loading'">
            <span class="cms-loader__spinner" aria-hidden="true"></span>
            @if (label()) {
                <span class="cms-loader__label">{{ label() }}</span>
            }
        </div>
    `,
    styles: [`
        .cms-loader {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 24px;
            color: var(--cms-text-muted);
        }
        /* Fills whatever it is dropped into and paints the surface behind it,
           which is what makes it usable as a COVER for content that is not
           ready to be seen rather than only as a placeholder in empty space. */
        .cms-loader--overlay {
            position: absolute;
            inset: 0;
            z-index: 5;
            background: var(--cms-surface);
        }
        /* Inline: the spinner sits BESIDE its label at text scale, for the waits
           that happen inside a row, a status bar or a button rather than in an
           empty panel. Same spinner, so a page does not switch identities between
           its big wait and its small one. */
        .cms-loader--inline {
            flex-direction: row;
            gap: 8px;
            padding: 0;
        }
        /* The spinner of the UI contract's state component, from the tokens: an arc on its track, one turn per
           --cms-spinner-duration. --cms-loader-size still sets its size; each token is read with its value as the
           fallback until the tokens that name it are installed. */
        .cms-loader__spinner {
            box-sizing: border-box;
            width: var(--cms-loader-size, var(--cms-spinner-size-page, 32px));
            height: var(--cms-loader-size, var(--cms-spinner-size-page, 32px));
            border: var(--cms-spinner-stroke, 2px) solid var(--cms-spinner-track, var(--cms-border));
            border-top-color: var(--cms-spinner-color, var(--cms-accent-text));
            border-radius: 50%;
            flex-shrink: 0;
            animation: cms-loader-turn var(--cms-spinner-duration, 800ms) linear infinite;
        }
        .cms-loader--inline .cms-loader__spinner {
            width: var(--cms-loader-size, var(--cms-spinner-size-inline, 16px));
            height: var(--cms-loader-size, var(--cms-spinner-size-inline, 16px));
        }
        @keyframes cms-loader-turn { to { transform: rotate(360deg); } }
        .cms-loader__label {
            font-size: .8125rem;
        }
        /* Motion sickness is not a stylistic preference: the spinner holds still and only breathes. */
        @media (prefers-reduced-motion: reduce) {
            .cms-loader__spinner { animation: cms-loader-breathe 2s ease-in-out infinite; }
        }
        @keyframes cms-loader-breathe {
            0%, 100% { opacity: .35; }
            50%      { opacity: 1; }
        }
    `],
})
export class CmsLoaderComponent {
    /** Optional caption. Absent renders the spinner alone, which suits a small inline wait. */
    readonly label = input<string>('');

    /** Cover the positioned ancestor rather than sitting in the flow. */
    readonly overlay = input<boolean>(false);

    /**
     * Row layout at text scale, for a wait inside a row, a status bar or a
     * button. Override `--cms-loader-size` to tune the spinner.
     */
    readonly inline = input<boolean>(false);
}

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The platform's loading indicator: the exclamation mark from Cool!MS,
 * drawing itself (#2073).
 *
 * ## Why a mark and not a spinner
 *
 * A spinner says "something is happening" and nothing else; every product has
 * one and none of them are yours. The bang is already the one glyph in the
 * wordmark that carries the brand, so a loader built from it says whose
 * software is thinking — for free, in the place a user is already looking.
 *
 * ## Why one component rather than a snippet per surface
 *
 * It is meant for every wait long enough to notice: a dashboard assembling its
 * cards, an editor paginating a document, an explorer listing a folder. Those
 * are different teams' files, and a copied SVG in each is how three loaders
 * that no longer match each other happen.
 *
 * ## The animation
 *
 * The stem wipes upward and the dot lands after it, on a loop — the shape being
 * WRITTEN rather than spun. It is deliberately calm: a loader is background
 * furniture, and anything with a hard beat gets irritating on the third viewing.
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
            <svg class="cms-loader__mark" viewBox="0 0 24 48" aria-hidden="true">
                <defs>
                    <clipPath [attr.id]="clipId">
                        <rect class="cms-loader__wipe" x="0" y="0" width="24" height="34" />
                    </clipPath>
                </defs>
                <!-- Ghost beneath: the mark stays legible as a SHAPE while the
                     wipe crosses it, so the loader never looks broken mid-cycle. -->
                <rect class="cms-loader__ghost" x="8" y="2" width="8" height="30" rx="4" />
                <circle class="cms-loader__ghost" cx="12" cy="42" r="4" />

                <rect class="cms-loader__stem" x="8" y="2" width="8" height="30" rx="4"
                      [attr.clip-path]="'url(#' + clipId + ')'" />
                <circle class="cms-loader__dot" cx="12" cy="42" r="4" />
            </svg>
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
        /* Inline: the mark sits BESIDE its label at text scale, for the waits
           that happen inside a row, a status bar or a button rather than in an
           empty panel. Same mark, so a page does not switch identities between
           its big wait and its small one. */
        .cms-loader--inline {
            flex-direction: row;
            gap: 8px;
            padding: 0;
        }
        .cms-loader--inline .cms-loader__mark {
            width: var(--cms-loader-size, 14px);
        }
        .cms-loader__mark {
            width: var(--cms-loader-size, 40px);
            height: auto;
            overflow: visible;
        }
        .cms-loader__ghost {
            fill: var(--cms-border);
        }
        .cms-loader__stem, .cms-loader__dot {
            fill: var(--cms-accent);
        }
        .cms-loader__wipe {
            animation: cms-loader-wipe 1.6s cubic-bezier(.65, 0, .35, 1) infinite;
            transform-origin: 12px 32px;
        }
        .cms-loader__dot {
            animation: cms-loader-dot 1.6s cubic-bezier(.65, 0, .35, 1) infinite;
            transform-origin: 12px 42px;
        }
        /* The stem is written from the base up: scaled about its own foot, so
           it grows out of the baseline instead of sliding into place. */
        @keyframes cms-loader-wipe {
            0%        { transform: scaleY(0); }
            45%, 70%  { transform: scaleY(1); }
            100%      { transform: scaleY(0); }
        }
        /* The dot lands after the stem has finished, then leaves with it. */
        @keyframes cms-loader-dot {
            0%, 40%   { opacity: 0; transform: scale(.4); }
            55%, 70%  { opacity: 1; transform: scale(1); }
            100%      { opacity: 0; transform: scale(.4); }
        }
        .cms-loader__label {
            font-size: .8125rem;
        }
        /* Motion sickness is not a stylistic preference: the mark holds its
           shape and only breathes. */
        @media (prefers-reduced-motion: reduce) {
            .cms-loader__wipe { animation: none; transform: scaleY(1); }
            .cms-loader__dot  { animation: cms-loader-breathe 2s ease-in-out infinite; opacity: 1; }
        }
        @keyframes cms-loader-breathe {
            0%, 100% { opacity: .35; }
            50%      { opacity: 1; }
        }
    `],
})
export class CmsLoaderComponent {
    /** Optional caption. Absent renders the mark alone, which suits a small inline wait. */
    readonly label = input<string>('');

    /** Cover the positioned ancestor rather than sitting in the flow. */
    readonly overlay = input<boolean>(false);

    /**
     * Row layout at text scale, for a wait inside a row, a status bar or a
     * button. Override `--cms-loader-size` to tune the mark.
     */
    readonly inline = input<boolean>(false);

    /**
     * A clip-path needs a document-unique id, and this component is used more
     * than once per page — two loaders sharing an id makes the second one clip
     * against the first one's rectangle and stop animating.
     */
    protected readonly clipId = 'cms-loader-' + Math.random().toString(36).slice(2, 9);
}

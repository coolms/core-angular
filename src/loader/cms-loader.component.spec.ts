import { TestBed } from '@angular/core/testing';
import { CmsLoaderComponent } from './cms-loader.component';

/** The loader turns the state component's spinner: a polite status, its label said, inline or as a cover. */
describe('CmsLoaderComponent', () => {
    function render(inputs: Record<string, unknown> = {}): HTMLElement {
        TestBed.configureTestingModule({ imports: [CmsLoaderComponent] });
        const fixture = TestBed.createComponent(CmsLoaderComponent);
        for (const [name, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(name, value);
        }
        fixture.detectChanges();

        return fixture.nativeElement as HTMLElement;
    }

    it('turns the spinner, never the old drawn mark, and says its label', () => {
        const host = render({ label: 'Reading the folder' });

        const loader = host.querySelector('.cms-loader')!;
        expect(loader.getAttribute('role')).toBe('status');
        expect(loader.getAttribute('aria-label')).toBe('Reading the folder');
        expect(host.querySelector('.cms-loader__spinner')).not.toBeNull();
        expect(host.querySelector('svg')).toBeNull();
        expect(host.querySelector('.cms-loader__label')?.textContent).toContain('Reading the folder');
        expect(getComputedStyle(host.querySelector('.cms-loader__spinner')!).animationName).toContain('cms-loader-turn');
    });

    it('is a small row inline, and a cover over its ancestor as an overlay; with no label it says "Loading"', () => {
        const inline = render({ inline: true });
        expect(inline.querySelector('.cms-loader')!.classList).toContain('cms-loader--inline');
        expect(inline.querySelector('.cms-loader')!.getAttribute('aria-label')).toBe('Loading');
        expect(inline.querySelector('.cms-loader__label')).toBeNull();
        expect(getComputedStyle(inline.querySelector('.cms-loader__spinner')!).width).toBe('16px');

        TestBed.resetTestingModule();
        const overlay = render({ overlay: true });
        expect(overlay.querySelector('.cms-loader')!.classList).toContain('cms-loader--overlay');
    });
});

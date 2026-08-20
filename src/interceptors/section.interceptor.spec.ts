import { TestBed } from '@angular/core/testing';
import {
    HttpClient, HttpInterceptorFn, provideHttpClient, withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { sectionInterceptor } from './section.interceptor';
import { CURRENT_SECTION } from '../section/current-section.port';

/**
 * H7 -- behaviour spec for the section interceptor.
 *
 * Coverage:
 *   1. Stamps `X-CoolMS-Section` on `/api/v1/*` when a slug is set.
 *   2. Skips when slug is null (no override).
 *   3. Skips non-API URLs.
 *   4. Skips `/api/v1/auth/*` endpoints.
 *   5. Does not overwrite an explicit caller-supplied header.
 */
describe('sectionInterceptor', () => {
    let http: HttpClient;
    let httpMock: HttpTestingController;

    // Nothing NGXS here any more: the interceptor asks a port for a slug, so
    // the test provides a slug. The store fake this used to need had to
    // reproduce `selectSnapshot`'s generic signature just to answer one
    // question -- which was the tell that the dependency was too big.
    const setup = (currentSlug: string | null): void => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([sectionInterceptor as HttpInterceptorFn])),
                provideHttpClientTesting(),
                { provide: CURRENT_SECTION, useValue: { currentSlug: () => currentSlug } },
            ],
        });
        http     = TestBed.inject(HttpClient);
        httpMock = TestBed.inject(HttpTestingController);
    };

    afterEach(() => httpMock.verify());

    // The kit has to work in an app with no Sections module at all.
    it('sends no header when nothing binds the port', () => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([sectionInterceptor as HttpInterceptorFn])),
                provideHttpClientTesting(),
            ],
        });
        http     = TestBed.inject(HttpClient);
        httpMock = TestBed.inject(HttpTestingController);

        http.get('/api/v1/content/pages').subscribe();
        const req = httpMock.expectOne('/api/v1/content/pages');
        expect(req.request.headers.has('X-CoolMS-Section')).toBe(false);
        req.flush({});
    });

    it('stamps header on /api/v1/* requests when slug is set', () => {
        setup('marketing');
        http.get('/api/v1/content/pages').subscribe();
        const req = httpMock.expectOne('/api/v1/content/pages');
        expect(req.request.headers.get('X-CoolMS-Section')).toBe('marketing');
        req.flush({});
    });

    it('does not stamp when slug is null', () => {
        setup(null);
        http.get('/api/v1/content/pages').subscribe();
        const req = httpMock.expectOne('/api/v1/content/pages');
        expect(req.request.headers.has('X-CoolMS-Section')).toBe(false);
        req.flush({});
    });

    it('skips non-API URLs', () => {
        setup('marketing');
        http.get('/theme/config').subscribe();
        const req = httpMock.expectOne('/theme/config');
        expect(req.request.headers.has('X-CoolMS-Section')).toBe(false);
        req.flush({});
    });

    it('skips /api/v1/auth/* endpoints', () => {
        setup('marketing');
        http.post('/api/v1/auth/login', {}).subscribe();
        const req = httpMock.expectOne('/api/v1/auth/login');
        expect(req.request.headers.has('X-CoolMS-Section')).toBe(false);
        req.flush({});
    });

    it('does not overwrite an explicit caller-supplied header', () => {
        setup('marketing');
        http.get('/api/v1/content/pages', {
            headers: { 'X-CoolMS-Section': 'override' },
        }).subscribe();
        const req = httpMock.expectOne('/api/v1/content/pages');
        expect(req.request.headers.get('X-CoolMS-Section')).toBe('override');
        req.flush({});
    });
});

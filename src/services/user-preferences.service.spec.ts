import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { PREFERENCES_NOTICE } from './preferences-notice.port';
import { UserPreferencesService } from './user-preferences.service';

const URL = '/api/v1/auth/me/preferences';
const KEY = 'coolms_ui_prefs';

/**
 * The person's interface preferences, as the server keeps them: one entry per grid (`datagrid:<id>`), the old nested
 * `grids` entry moved there on load; only the entries that changed are sent; a refusal (422) is shown to the person;
 * and on load the server's value wins for every entry it has.
 */
describe('UserPreferencesService', () => {
    let prefs: UserPreferencesService;
    let http: HttpTestingController;
    let told: string[];

    const local = (): Record<string, unknown> => JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const seed = (all: Record<string, unknown>): void => localStorage.setItem(KEY, JSON.stringify(all));
    const sent = (): unknown[] => http.match(r => r.method === 'PATCH' && r.url === URL).map(r => r.request.body);

    function build(notice = true): void {
        told = [];
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Store, useValue: { selectSnapshot: () => ({ auth: { preferencesUrl: URL } }) } },
                ...(notice ? [{ provide: PREFERENCES_NOTICE, useValue: { refused: (s: string) => told.push(s) } }] : []),
            ],
        });
        prefs = TestBed.inject(UserPreferencesService);
        http = TestBed.inject(HttpTestingController);
    }

    beforeEach(() => localStorage.removeItem(KEY));
    afterEach(() => localStorage.removeItem(KEY));

    describe('one entry per grid', () => {
        it('keeps a grid in its own datagrid:<id> entry, never under grids', fakeAsync(() => {
            build();
            prefs.setColumns('navi:navi_nodes', ['title', 'slug']);
            prefs.setColumnWidth('navi:navi_nodes', 'title', 240);

            expect(local()['datagrid:navi:navi_nodes']).toEqual({ columns: ['title', 'slug'], columnWidths: { title: 240 } });
            expect('grids' in local()).toBeFalse();
            expect(prefs.getGridPref('navi:navi_nodes')).toEqual({ columns: ['title', 'slug'], columnWidths: { title: 240 } });
            tick(2000);
            expect(sent()).toEqual([{ uiPrefs: { 'datagrid:navi:navi_nodes': { columns: ['title', 'slug'], columnWidths: { title: 240 } } } }]);
        }));

        it('moves the old nested grids entry to one entry per grid on load, and sends those entries only', fakeAsync(() => {
            seed({
                grids: { users: { columns: ['email'] }, 'navi:navi_nodes': { columnWidths: { title: 200 } } },
                panel: { left: { width: 300, collapsed: false } },
                'datagrid:users': { columns: ['name'] },
            });
            build();

            expect(prefs.getGridPref('users')).withContext('its own entry wins over the nested one').toEqual({ columns: ['name'] });
            expect(prefs.getGridPref('navi:navi_nodes')).toEqual({ columnWidths: { title: 200 } });
            expect(Object.keys(local()).sort()).toEqual(['datagrid:navi:navi_nodes', 'datagrid:users', 'panel']);
            tick(2000);
            expect(sent()).toEqual([{ uiPrefs: { 'datagrid:navi:navi_nodes': { columnWidths: { title: 200 } } } }]);
        }));

        it('does not take a host\'s own entry for a grid, though it has column widths', fakeAsync(() => {
            seed({ 'admin:mail:panes': { columnWidths: { folders: 230, list: 340 } } });
            build();

            expect(prefs.getGridPref('admin:mail:panes')).toBeNull();
            expect(local()).toEqual({ 'admin:mail:panes': { columnWidths: { folders: 230, list: 340 } } });
            tick(2000);
            expect(sent()).toEqual([]);
        }));

        it('a reset sends the grid\'s fields empty at once, and the grid reads as having none', () => {
            seed({ 'datagrid:users': { columns: ['email'], columnWidths: { email: 200 } } });
            build();
            prefs.resetGrid('users');

            expect(sent()).toEqual([{ uiPrefs: { 'datagrid:users': { columns: null, columnWidths: null } } }]);
            expect(prefs.getGridPref('users')).toBeNull();
            prefs.loadFromServer({ 'datagrid:users': { columns: null, columnWidths: null } });
            expect(prefs.getGridPref('users')).withContext('as the server answers it after the reset').toBeNull();
        });
    });

    describe('only the entries that changed are sent', () => {
        it('one PATCH, after the debounce, naming the changed entries and no other', fakeAsync(() => {
            seed({
                terminal: { height: 100 },
                panel: { left: { width: 300, collapsed: false } },
                'datagrid:users': { columns: ['email'] },
                'admin:mail:panes': { columnWidths: { folders: 230, list: 340 } },
            });
            build();
            prefs.setTerminalHeight(320.4);
            prefs.setColumnWidth('orders', 'total', 90);
            tick(1000);
            expect(sent()).withContext('debounced').toEqual([]);
            prefs.setTerminalHeight(330);
            tick(2000);

            expect(sent()).toEqual([{ uiPrefs: { terminal: { height: 330 }, 'datagrid:orders': { columnWidths: { total: 90 } } } }]);
            tick(5000);
            expect(sent()).withContext('nothing more').toEqual([]);
        }));

        it('a failed send that is not a refusal goes again with the next change', fakeAsync(() => {
            build();
            prefs.setTerminalHeight(300);
            tick(2000);
            http.expectOne(URL).flush(null, { status: 503, statusText: 'Unavailable' });
            prefs.setPanelState('left', 280, false);
            tick(2000);

            expect(sent()).toEqual([{ uiPrefs: { terminal: { height: 300 }, panel: { left: { width: 280, collapsed: false } } } }]);
        }));
    });

    describe('a failed send that is not a refusal is tried again', () => {
        const fail = (): void => http.expectOne(URL).flush(null, { status: 503, statusText: 'Unavailable' });
        const ok = (): void => http.expectOne(URL).flush({});

        beforeEach(() => spyOn(console, 'warn'));

        it('a 503 then a success: the entries go again at 5 s, and once only', fakeAsync(() => {
            build();
            prefs.setTerminalHeight(300);
            tick(2000);
            fail();
            tick(4999);
            expect(sent()).withContext('not before 5 s').toEqual([]);
            tick(1);
            const again = http.expectOne(URL);
            expect(again.request.body).toEqual({ uiPrefs: { terminal: { height: 300 } } });
            again.flush({});
            tick(600_000);
            expect(sent()).withContext('nothing more after the success').toEqual([]);
        }));

        it('repeated failures wait 5 s, 30 s, 120 s, then 120 s again', fakeAsync(() => {
            build();
            prefs.setTerminalHeight(300);
            tick(2000);
            fail();
            for (const wait of [5_000, 30_000, 120_000, 120_000]) {
                tick(wait - 1);
                expect(sent()).withContext(`not before ${wait} ms`).toEqual([]);
                tick(1);
                fail();
            }
            tick(120_000);
            ok();
        }));

        it('a change made while a try again is scheduled goes with the next send', fakeAsync(() => {
            build();
            prefs.setTerminalHeight(300);
            tick(2000);
            fail();
            prefs.setPanelState('left', 280, false);
            tick(2000);
            const next = http.expectOne(URL);
            expect(next.request.body).toEqual({ uiPrefs: { terminal: { height: 300 }, panel: { left: { width: 280, collapsed: false } } } });
            next.flush({});
            tick(600_000);
            expect(sent()).withContext('the scheduled try again went with it').toEqual([]);
        }));

        it('goes at once when the browser comes back online', fakeAsync(() => {
            build();
            prefs.setTerminalHeight(300);
            tick(2000);
            fail();
            tick(1000);
            window.dispatchEvent(new Event('online'));
            expect(sent()).toEqual([{ uiPrefs: { terminal: { height: 300 } } }]);
            tick(600_000);
            expect(sent()).withContext('the 5 s try again was dropped').toEqual([]);
        }));

        it('goes at once when the tab is shown again, not when it is hidden', fakeAsync(() => {
            build();
            const state = spyOnProperty(document, 'visibilityState').and.returnValue('hidden');
            prefs.setTerminalHeight(300);
            tick(2000);
            fail();
            document.dispatchEvent(new Event('visibilitychange'));
            expect(sent()).withContext('hidden').toEqual([]);
            state.and.returnValue('visible');
            document.dispatchEvent(new Event('visibilitychange'));
            expect(sent()).toEqual([{ uiPrefs: { terminal: { height: 300 } } }]);
            tick(600_000);
        }));

        it('an online event with nothing waiting sends nothing', fakeAsync(() => {
            build();
            window.dispatchEvent(new Event('online'));
            expect(sent()).toEqual([]);
        }));

        it('a 422 is never tried again', fakeAsync(() => {
            build();
            prefs.setColumns('users', ['email']);
            tick(2000);
            http.expectOne(URL).flush({ detail: 'too big' }, { status: 422, statusText: 'Unprocessable Content' });
            tick(600_000);
            window.dispatchEvent(new Event('online'));
            expect(sent()).toEqual([]);
        }));

        it('after a success, the next failure waits 5 s again', fakeAsync(() => {
            build();
            prefs.setTerminalHeight(300);
            tick(2000);
            fail();
            tick(5000);
            fail();
            tick(30_000);
            ok();
            prefs.setTerminalHeight(310);
            tick(2000);
            fail();
            tick(4999);
            expect(sent()).withContext('not before 5 s').toEqual([]);
            tick(1);
            expect(sent()).toEqual([{ uiPrefs: { terminal: { height: 310 } } }]);
        }));

        it('a scheduled try again is dropped when the service is destroyed', fakeAsync(() => {
            build();
            prefs.setTerminalHeight(300);
            tick(2000);
            fail();
            TestBed.resetTestingModule();
            tick(600_000);
            expect(http.match(() => true)).toEqual([]);
        }));
    });

    describe('a refusal (422)', () => {
        const refusal = {
            type: '/errors/identity/preferences-refused',
            title: 'Preferences not stored',
            status: 422,
            detail: 'The preferences entry "datagrid:users" would take 17000 bytes; an entry takes at most 16384. Nothing was stored.',
        };

        it('is shown to the person in the server\'s words, not only written to the console, and not sent again', fakeAsync(() => {
            build();
            const warn = spyOn(console, 'warn');
            prefs.setColumns('users', ['email']);
            tick(2000);
            http.expectOne(URL).flush(refusal, { status: 422, statusText: 'Unprocessable Content' });

            expect(told).toEqual([
                'Your preferences could not be saved: The preferences entry "datagrid:users" would take 17000 bytes; an entry takes at most 16384. Nothing was stored.',
            ]);
            expect(warn).not.toHaveBeenCalled();
            prefs.setTerminalHeight(300);
            tick(2000);
            expect(sent()).withContext('the refused entry is not sent again').toEqual([{ uiPrefs: { terminal: { height: 300 } } }]);
        }));
    });

    describe('on load', () => {
        it('the server\'s value wins over the local one for every entry it has; one only this browser has stays', () => {
            seed({
                terminal: { height: 100 },
                panel: { left: { width: 300, collapsed: false } },
                'datagrid:users': { columns: ['local'] },
            });
            build();
            prefs.loadFromServer({
                terminal: { height: 400 },
                'datagrid:users': { columns: ['server'] },
                'admin:mail:panes': { columnWidths: { folders: 250, list: 360 } },
            });

            expect(prefs.getTerminalHeight()).toBe(400);
            expect(prefs.getGridPref('users')).toEqual({ columns: ['server'] });
            expect(prefs.getPanelState('left')).toEqual({ width: 300, collapsed: false });
            expect(local()['admin:mail:panes']).toEqual({ columnWidths: { folders: 250, list: 360 } });
            expect(sent()).withContext('a load sends nothing').toEqual([]);
        });

        it('the server\'s old nested grids give a grid an entry only where neither side has one', fakeAsync(() => {
            seed({ 'datagrid:local': { columns: ['mine'] } });
            build();
            prefs.loadFromServer({
                grids: { users: { columns: ['old'] }, local: { columns: ['old'] }, orders: { columns: ['old'] } },
                'datagrid:users': { columns: ['new'] },
            });

            expect(prefs.getGridPref('users')).toEqual({ columns: ['new'] });
            expect(prefs.getGridPref('local')).toEqual({ columns: ['mine'] });
            expect(prefs.getGridPref('orders')).toEqual({ columns: ['old'] });
            expect('grids' in local()).toBeFalse();
            tick(2000);
            expect(sent()).toEqual([{ uiPrefs: { 'datagrid:orders': { columns: ['old'] } } }]);
        }));

        it('an entry changed here and not yet sent keeps its local value', fakeAsync(() => {
            build();
            prefs.setTerminalHeight(500);
            prefs.loadFromServer({ terminal: { height: 100 }, panel: { left: { width: 260, collapsed: true } } });

            expect(prefs.getTerminalHeight()).toBe(500);
            expect(prefs.getPanelState('left')).toEqual({ width: 260, collapsed: true });
            tick(2000);
            expect(sent()).toEqual([{ uiPrefs: { terminal: { height: 500 } } }]);
        }));
    });
});

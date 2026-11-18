import type { EyesConfig, EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testEyesConfig } from '~/tests/helpers';

const noopPerformanceObserver = class {
    observe() {}
    disconnect() {}
};

type FetchCall = [string, { body: string }];

describe('browser storage', () => {
    const OPT_OUT_READ = 'localStorage.getItem(eyes_optout)';

    let fetchSpy: ReturnType<typeof vi.fn>;
    let storageAccess: string[];
    let navigations = 0;

    /** Records every touch of a store, so anything but the expected read fails a test. */
    const recordingStore = <T extends object>(area: string): T =>
        new Proxy({} as T, {
            get: (_, property) => {
                return (...args: unknown[]) => {
                    storageAccess.push(`${area}.${String(property)}(${args.join(', ')})`);

                    return null;
                };
            },
            set: (_, property) => {
                storageAccess.push(`${area}.${String(property)} assigned`);

                return true;
            },
            deleteProperty: (_, property) => {
                storageAccess.push(`${area}.${String(property)} deleted`);

                return true;
            },
        });

    const sentEvents = (): EyesEvent[] =>
        (fetchSpy.mock.calls as FetchCall[]).flatMap(
            ([, { body }]) => JSON.parse(body) as EyesEvent[],
        );

    const clearCookie = () => {
        // biome-ignore lint/suspicious/noDocumentCookie: We need to manipulate cookies in this test.
        document.cookie = 'eyes_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    };

    const cookieNames = () =>
        document.cookie
            .split('; ')
            .filter(Boolean)
            .map(cookie => cookie.split('=')[0]);

    const setVisibility = (value: DocumentVisibilityState) => {
        Object.defineProperty(document, 'visibilityState', {
            value,
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
    };

    /** One page load: pageview, event, input, an SPA navigation, and leaving the page. */
    const browse = async (config: Partial<EyesConfig> = {}) => {
        vi.resetModules();
        setVisibility('visible');
        const { init } = await import('~/index.js');
        const api = init(testEyesConfig(config));

        api.track('Signup');
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('pointerdown'));
        window.dispatchEvent(new KeyboardEvent('keydown'));
        vi.advanceTimersByTime(3000);
        navigations += 1;
        history.pushState({}, '', `/next-${navigations}`);
        vi.advanceTimersByTime(3000);
        setVisibility('hidden');
        await api.flush();

        return api;
    };

    beforeEach(() => {
        vi.useFakeTimers();

        fetchSpy = vi.fn().mockResolvedValue(new Response());
        vi.stubGlobal('fetch', fetchSpy);
        vi.stubGlobal('PerformanceObserver', noopPerformanceObserver);
        // Falls through to fetch, so every event of a page being left is recorded there too.
        vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false);

        Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Normal Browser');

        storageAccess = [];
        vi.stubGlobal('localStorage', recordingStore<Storage>('localStorage'));
        vi.stubGlobal('sessionStorage', recordingStore<Storage>('sessionStorage'));
        vi.stubGlobal('indexedDB', recordingStore<IDBFactory>('indexedDB'));

        clearCookie();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        clearCookie();
        setVisibility('visible');
    });

    describe('without consent', () => {
        it('writes no cookie and touches no store except reading the opt-out flag', async () => {
            const setCookie = vi.spyOn(document, 'cookie', 'set');

            const api = await browse();

            expect(sentEvents().map(event => event.type)).toEqual(
                expect.arrayContaining(['pageview', 'event', 'engagement']),
            );
            expect(setCookie).not.toHaveBeenCalled();
            expect(cookieNames()).toEqual([]);
            expect(new Set(storageAccess)).toEqual(new Set([OPT_OUT_READ]));
            expect(window.name).toBe('');

            await api.shutdown();
        });

        it('keeps one session across SPA navigations and starts another on a page load', async () => {
            const api = await browse();
            const firstLoad = sentEvents();
            await api.shutdown();
            fetchSpy.mockClear();

            const nextApi = await browse();
            const nextLoad = sentEvents();
            await nextApi.shutdown();

            const sessionsOf = (events: EyesEvent[]) =>
                new Set(events.map(event => event.sessionId));
            const pageviews = firstLoad.filter(event => event.type === 'pageview');
            expect(pageviews.length).toBeGreaterThanOrEqual(2);
            expect(sessionsOf(firstLoad).size).toBe(1);
            expect(sessionsOf(nextLoad).size).toBe(1);
            expect(sessionsOf(nextLoad)).not.toEqual(sessionsOf(firstLoad));
        });
    });

    describe('with consent', () => {
        it('stores only the eyes_id cookie, also on the next page load', async () => {
            const api = await browse();

            api.consent();
            api.track('After consent');
            await api.flush();
            await api.shutdown();

            const nextApi = await browse();
            await nextApi.shutdown();

            expect(sentEvents().at(-1)?.eyesId).toBeTypeOf('string');
            expect(cookieNames()).toEqual(['eyes_id']);
            expect(new Set(storageAccess)).toEqual(new Set([OPT_OUT_READ]));
        });

        it('stores only the eyes_id cookie on a site that does not wait for consent', async () => {
            const api = await browse({ consentRequired: false });
            await api.shutdown();

            expect(cookieNames()).toEqual(['eyes_id']);
            expect(new Set(storageAccess)).toEqual(
                new Set([OPT_OUT_READ, 'localStorage.getItem(eyes_consent_revoked)']),
            );
        });
    });
});

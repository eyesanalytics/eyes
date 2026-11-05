import type { EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testEyesConfig } from '~/tests/helpers';

const readEyesId = (): string | null => {
    const match = document.cookie.match(/(?:^|; )eyes_id=([^;]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const noopPerformanceObserver = class {
    observe() {}
    disconnect() {}
};

type FetchCall = [string, { body: string }];

describe('opt-out', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    const sentEvents = (): EyesEvent[] =>
        (fetchSpy.mock.calls as FetchCall[]).flatMap(
            ([, { body }]) => JSON.parse(body) as EyesEvent[],
        );

    const clearCookie = () => {
        // biome-ignore lint/suspicious/noDocumentCookie: We need to manipulate cookies in this test.
        document.cookie = 'eyes_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    };

    const setGlobalPrivacyControl = (value: boolean | undefined) => {
        Object.defineProperty(navigator, 'globalPrivacyControl', { value, configurable: true });
    };

    const nextPageLoad = async () => {
        vi.resetModules();

        return import('~/index.js');
    };

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();

        fetchSpy = vi.fn().mockResolvedValue(new Response());
        vi.stubGlobal('fetch', fetchSpy);
        vi.stubGlobal('PerformanceObserver', noopPerformanceObserver);

        Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Normal Browser');

        clearCookie();
        sessionStorage.clear();
        localStorage.clear();
        location.hash = '';
        setGlobalPrivacyControl(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        clearCookie();
        localStorage.clear();
        location.hash = '';
        setGlobalPrivacyControl(undefined);
    });

    const importModule = () => import('~/index.js');

    describe('optOut', () => {
        it('stores the flag and sends nothing afterwards', async () => {
            const { init, optOut, track, page, identify, consent, flush } = await importModule();
            init(testEyesConfig({ autoPageview: false }));

            optOut();
            track('after_opt_out');
            page();
            consent();
            identify({ id: 'u_1' });
            await flush();

            expect(localStorage.getItem('eyes_optout')).toBe('1');
            expect(sentEvents()).toHaveLength(0);
        });

        it('drops events that were queued but not sent yet', async () => {
            const { init, optOut, track, flush } = await importModule();
            init(testEyesConfig({ autoPageview: false }));

            track('before_opt_out');
            optOut();
            await flush();

            expect(sentEvents()).toHaveLength(0);
        });

        it('still sends consent_revoked for a visitor with an eyes_id, and removes the cookie', async () => {
            const { init, consent, optOut, flush } = await importModule();
            init(testEyesConfig({ autoPageview: false }));
            consent();
            const eyesId = readEyesId();

            optOut();
            await flush();

            expect(readEyesId()).toBeNull();
            const events = sentEvents();
            expect(events.map(event => event.type)).toEqual(['consent_revoked']);
            expect(events[0]?.eyesId).toBe(eyesId);
        });

        it('sends nothing on later page loads, including the automatic pageview', async () => {
            const first = await importModule();
            first.init(testEyesConfig({ autoPageview: false }));
            first.optOut();
            await first.shutdown();

            const { init, track, flush } = await nextPageLoad();
            init(testEyesConfig({ autoPageview: true }));
            track('later');
            await flush();

            expect(sentEvents()).toHaveLength(0);
        });

        it('sets no cookie on a site that does not wait for consent', async () => {
            const first = await importModule();
            first.optOut();

            const { init } = await nextPageLoad();
            init(testEyesConfig({ consentRequired: false, autoPageview: false }));

            expect(readEyesId()).toBeNull();
        });

        it('works before init, and erases a cookie the visitor already had', async () => {
            const first = await importModule();
            first.init(testEyesConfig({ autoPageview: false }));
            first.consent();
            await first.shutdown();
            const eyesId = readEyesId();
            fetchSpy.mockClear();

            const { init, optOut, track, flush } = await nextPageLoad();
            optOut();
            track('before_init');
            init(testEyesConfig({ autoPageview: false }));
            await flush();

            expect(readEyesId()).toBeNull();
            const events = sentEvents();
            expect(events.map(event => event.type)).toEqual(['consent_revoked']);
            expect(events[0]?.eyesId).toBe(eyesId);
        });

        it('is not undone by a consent banner calling consent() on every page load', async () => {
            const first = await importModule();
            first.init(testEyesConfig({ consentRequired: false, autoPageview: false }));
            first.optOut();
            await first.shutdown();
            fetchSpy.mockClear();

            const { init, consent, track, flush } = await nextPageLoad();
            init(testEyesConfig({ consentRequired: false, autoPageview: false }));
            consent();
            track('after_banner');
            await flush();

            expect(localStorage.getItem('eyes_optout')).toBe('1');
            expect(readEyesId()).toBeNull();
            expect(sentEvents()).toHaveLength(0);
        });
    });

    describe('revokeConsent', () => {
        it('does not opt the visitor out: cookieless tracking goes on', async () => {
            const { init, revokeConsent, track, flush } = await importModule();
            init(testEyesConfig({ consentRequired: false, autoPageview: false }));

            revokeConsent();
            await flush();
            fetchSpy.mockClear();
            track('after_revoke');
            await flush();

            expect(localStorage.getItem('eyes_optout')).toBeNull();
            const event = sentEvents().find(sent => sent.type === 'event');
            expect(event).toBeDefined();
            expect(event?.eyesId).toBeUndefined();
        });
    });

    describe('optIn', () => {
        it('resumes cookieless tracking, without a cookie until consent()', async () => {
            const { init, optOut, optIn, consent, track, flush } = await importModule();
            init(testEyesConfig({ autoPageview: false }));
            optOut();

            optIn();
            track('after_opt_in');
            await flush();

            expect(localStorage.getItem('eyes_optout')).toBeNull();
            expect(readEyesId()).toBeNull();
            const event = sentEvents().find(sent => sent.type === 'event');
            expect(event).toBeDefined();
            expect(event?.eyesId).toBeUndefined();

            consent();

            expect(readEyesId()).not.toBeNull();
        });
    });

    describe('URL fragments', () => {
        it('#eyes-ignore opts this browser out before the first pageview', async () => {
            location.hash = '#eyes-ignore';
            const { init, flush } = await importModule();
            init(testEyesConfig({ autoPageview: true }));
            await flush();

            expect(localStorage.getItem('eyes_optout')).toBe('1');
            expect(sentEvents()).toHaveLength(0);
        });

        it('#eyes-unignore clears the flag', async () => {
            localStorage.setItem('eyes_optout', '1');
            location.hash = '#eyes-unignore';
            const { init, track, flush } = await importModule();
            init(testEyesConfig({ autoPageview: false }));
            track('included_again');
            await flush();

            expect(localStorage.getItem('eyes_optout')).toBeNull();
            expect(sentEvents().some(event => event.type === 'event')).toBe(true);
        });
    });

    describe('Global Privacy Control', () => {
        it('blocks the automatic cookie and identify, but keeps cookieless tracking', async () => {
            setGlobalPrivacyControl(true);
            const { init, identify, track, flush } = await importModule();
            init(testEyesConfig({ consentRequired: false, autoPageview: false }));

            identify({ id: 'u_1' });
            track('with_gpc');
            await flush();

            expect(readEyesId()).toBeNull();
            const events = sentEvents();
            expect(events.some(event => event.type === 'identify')).toBe(false);
            const event = events.find(sent => sent.type === 'event');
            expect(event).toBeDefined();
            expect(event?.eyesId).toBeUndefined();
        });

        it('removes an automatic cookie set before the signal was turned on', async () => {
            const first = await importModule();
            first.init(testEyesConfig({ consentRequired: false, autoPageview: false }));
            await first.shutdown();
            expect(readEyesId()).not.toBeNull();

            setGlobalPrivacyControl(true);
            const { init } = await nextPageLoad();
            init(testEyesConfig({ consentRequired: false, autoPageview: false }));

            expect(readEyesId()).toBeNull();
        });

        it('lets an explicit consent() grant', async () => {
            setGlobalPrivacyControl(true);
            const { init, consent } = await importModule();
            init(testEyesConfig({ consentRequired: false, autoPageview: false }));

            consent();

            expect(readEyesId()).not.toBeNull();
        });

        it('changes nothing on a site that requires consent', async () => {
            setGlobalPrivacyControl(true);
            const { init, consent, identify, flush } = await importModule();
            init(testEyesConfig({ consentRequired: true, autoPageview: false }));

            consent();
            identify({ id: 'u_1' });
            await flush();

            expect(sentEvents().some(event => event.type === 'identify')).toBe(true);
        });
    });
});

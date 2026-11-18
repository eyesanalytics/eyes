import type { EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testEyesConfig } from '~/tests/helpers';

const noopPerformanceObserver = class {
    observe() {}
    disconnect() {}
};

// Reports the page's response time, so the page has vitals to send when it is hidden
const navigationObserver = class {
    private callback: (list: { getEntries: () => object[] }) => void;

    constructor(callback: (list: { getEntries: () => object[] }) => void) {
        this.callback = callback;
    }

    observe({ type }: PerformanceObserverInit) {
        if (type === 'navigation') {
            this.callback({ getEntries: () => [{ responseStart: 250, activationStart: 0 }] });
        }
    }

    disconnect() {}
};

type FetchCall = [string, { body: string }];

describe('sessions around consent', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    const sentEvents = (): EyesEvent[] =>
        (fetchSpy.mock.calls as FetchCall[]).flatMap(
            ([, { body }]) => JSON.parse(body) as EyesEvent[],
        );

    const setCookie = (value: string, expires = '') => {
        // biome-ignore lint/suspicious/noDocumentCookie: We need to manipulate cookies in this test.
        document.cookie = `eyes_id=${value}; path=/${expires}`;
    };

    const clearCookie = () => setCookie('', '; expires=Thu, 01 Jan 1970 00:00:00 GMT');

    const readEyesId = (): string | null =>
        document.cookie.match(/(?:^|; )eyes_id=([^;]+)/)?.[1] ?? null;

    const setVisibility = (state: DocumentVisibilityState) => {
        Object.defineProperty(document, 'visibilityState', {
            value: state,
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
    };

    const startTracker = async () => {
        const { init } = await import('~/index.js');

        return init(testEyesConfig({ autoPageview: false }));
    };

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();

        fetchSpy = vi.fn().mockResolvedValue(new Response());
        vi.stubGlobal('fetch', fetchSpy);
        vi.stubGlobal('PerformanceObserver', noopPerformanceObserver);
        // A hidden page flushes by beacon; failing it sends the batch through fetch, in order
        vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false);

        Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Normal Browser');

        clearCookie();
        localStorage.clear();
        setVisibility('visible');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        clearCookie();
        localStorage.clear();
        setVisibility('visible');
    });

    describe('consent_granted', () => {
        it('leaves at once, with the page load it belongs to', async () => {
            const api = await startTracker();
            api.page();
            await vi.advanceTimersByTimeAsync(0);
            fetchSpy.mockClear();

            api.consent();

            const [granted] = sentEvents();
            expect(granted?.type).toBe('consent_granted');
            expect(granted?.pageLoadId).toMatch(/^[0-9a-f-]{36}$/);

            await api.shutdown();
        });
    });

    it('keeps the session through consent', async () => {
        const api = await startTracker();

        api.page();
        api.consent();
        api.page();
        await api.flush();

        expect(new Set(sentEvents().map(event => event.sessionId)).size).toBe(1);

        await api.shutdown();
    });

    describe('when consent is withdrawn', () => {
        it('files the engagement, then the revocation, on the visit, and leaves it at once', async () => {
            const api = await startTracker();
            api.consent();
            api.page();
            await vi.advanceTimersByTimeAsync(2000);
            const pageview = sentEvents().find(event => event.type === 'pageview');
            fetchSpy.mockClear();

            api.revokeConsent();
            api.page();
            await api.flush();

            const [engagement, revoked, next, ...rest] = sentEvents();
            const visit = {
                eyesId: pageview?.eyesId,
                sessionId: pageview?.sessionId,
                pageLoadId: pageview?.pageLoadId,
            };
            expect(pageview?.eyesId).toBeTruthy();
            expect(engagement).toMatchObject({ type: 'engagement', ...visit });
            expect(revoked).toMatchObject({ type: 'consent_revoked', ...visit });
            expect(next?.type).toBe('pageview');
            expect(next?.eyesId).toBeUndefined();
            expect(next?.sessionId).not.toBe(pageview?.sessionId);
            expect(next?.pageLoadId).not.toBe(pageview?.pageLoadId);
            expect(rest).toEqual([]);

            await api.shutdown();
        });

        it('reports no more engagement from the page until its next pageview', async () => {
            const api = await startTracker();
            api.consent();
            api.page();
            await vi.advanceTimersByTimeAsync(2000);
            api.revokeConsent();
            await api.flush();
            fetchSpy.mockClear();

            await vi.advanceTimersByTimeAsync(2000);
            setVisibility('hidden');
            await vi.advanceTimersByTimeAsync(0);
            expect(sentEvents()).toEqual([]);

            setVisibility('visible');
            api.page();
            await vi.advanceTimersByTimeAsync(2000);
            setVisibility('hidden');
            await vi.advanceTimersByTimeAsync(0);

            const [pageview, engagement] = sentEvents();
            expect(engagement?.type).toBe('engagement');
            expect(engagement?.eyesId).toBeUndefined();
            expect(engagement?.sessionId).toBe(pageview?.sessionId);
            expect(engagement?.pageLoadId).toBe(pageview?.pageLoadId);

            await api.shutdown();
        });

        it('changes nothing for a visitor without an eyes_id', async () => {
            const api = await startTracker();
            api.page();
            await vi.advanceTimersByTimeAsync(2000);
            const [pageview] = sentEvents();
            fetchSpy.mockClear();

            api.revokeConsent();
            await api.flush();
            expect(sentEvents()).toEqual([]);

            setVisibility('hidden');
            await vi.advanceTimersByTimeAsync(0);

            const [engagement] = sentEvents();
            expect(engagement?.type).toBe('engagement');
            expect(engagement?.sessionId).toBe(pageview?.sessionId);
            expect(engagement?.pageLoadId).toBe(pageview?.pageLoadId);

            await api.shutdown();
        });

        it('leaves the visit when nothing active was sent between consent and withdrawal', async () => {
            const api = await startTracker();

            api.page();
            api.consent();
            api.revokeConsent();
            api.page();
            await api.flush();

            const pageviews = sentEvents().filter(event => event.type === 'pageview');
            expect(pageviews[1]?.sessionId).not.toBe(pageviews[0]?.sessionId);

            await api.shutdown();
        });
    });

    describe('with another tab open', () => {
        it('picks up consent given there, on the same session', async () => {
            const api = await startTracker();
            api.page();

            setCookie('from-another-tab');
            api.page();
            await api.flush();

            const [before, after] = sentEvents();
            expect(before?.eyesId).toBeUndefined();
            expect(after?.eyesId).toBe('from-another-tab');
            expect(after?.sessionId).toBe(before?.sessionId);

            await api.shutdown();
        });

        it('leaves the visit once consent is withdrawn there', async () => {
            setCookie('from-another-tab');
            const api = await startTracker();
            api.page();

            clearCookie();
            api.page();
            await api.flush();

            const [before, after] = sentEvents();
            expect(before?.eyesId).toBe('from-another-tab');
            expect(after?.eyesId).toBeUndefined();
            expect(after?.sessionId).not.toBe(before?.sessionId);
            expect(after?.pageLoadId).not.toBe(before?.pageLoadId);

            await api.shutdown();
        });

        it('sends nothing on the visit from a page hidden after consent was withdrawn there', async () => {
            setCookie('from-another-tab');
            const api = await startTracker();
            api.page();
            await vi.advanceTimersByTimeAsync(2000);
            const [before] = sentEvents();
            fetchSpy.mockClear();

            clearCookie();
            setVisibility('hidden');
            await vi.advanceTimersByTimeAsync(0);
            expect(sentEvents()).toEqual([]);

            setVisibility('visible');
            api.page();
            await api.flush();

            const [after] = sentEvents();
            expect(after?.eyesId).toBeUndefined();
            expect(after?.sessionId).not.toBe(before?.sessionId);
            expect(after?.pageLoadId).not.toBe(before?.pageLoadId);

            await api.shutdown();
        });

        it('stays withdrawn here if the cookie comes back from elsewhere', async () => {
            const api = await startTracker();
            api.consent();
            api.revokeConsent();

            setCookie('from-another-tab');
            api.page();
            await api.flush();

            expect(sentEvents().at(-1)?.eyesId).toBeUndefined();

            await api.shutdown();
        });

        describe('when consent() follows a withdrawal there', () => {
            it('leaves the visit and grants again, with a new eyes_id on a new visit', async () => {
                setCookie('from-another-tab');
                const api = await startTracker();
                api.page();
                await vi.advanceTimersByTimeAsync(2000);
                const [before] = sentEvents();
                fetchSpy.mockClear();

                clearCookie();
                api.consent();
                api.track('next');
                await api.flush();

                const [granted, next, ...rest] = sentEvents();
                const eyesId = readEyesId();
                expect(eyesId).toBeTruthy();
                expect(eyesId).not.toBe('from-another-tab');
                expect(granted).toMatchObject({ type: 'consent_granted', eyesId });
                expect(granted?.sessionId).not.toBe(before?.sessionId);
                expect(granted?.pageLoadId).not.toBe(before?.pageLoadId);
                expect(next).toMatchObject({
                    type: 'event',
                    eyesId,
                    sessionId: granted?.sessionId,
                    pageLoadId: granted?.pageLoadId,
                });
                expect(rest).toEqual([]);

                await api.shutdown();
            });

            it('drops the engagement and vitals pending for the old visit', async () => {
                vi.stubGlobal('PerformanceObserver', navigationObserver);
                setCookie('from-another-tab');
                const api = await startTracker();
                api.page();
                await vi.advanceTimersByTimeAsync(2000);
                fetchSpy.mockClear();

                clearCookie();
                api.consent();
                setVisibility('hidden');
                await vi.advanceTimersByTimeAsync(0);
                expect(sentEvents().map(event => event.type)).toEqual(['consent_granted']);

                setVisibility('visible');
                api.page();
                await vi.advanceTimersByTimeAsync(2000);
                setVisibility('hidden');
                await vi.advanceTimersByTimeAsync(0);

                const [granted, pageview, engagement, ...rest] = sentEvents();
                const visit = {
                    eyesId: granted?.eyesId,
                    sessionId: granted?.sessionId,
                    pageLoadId: granted?.pageLoadId,
                };
                expect(pageview).toMatchObject({ type: 'pageview', ...visit });
                expect(engagement).toMatchObject({ type: 'engagement', ...visit });
                expect(rest).toEqual([]);

                await api.shutdown();
            });

            it('clears the stored withdrawal on a site that does not wait for consent', async () => {
                const { init } = await import('~/index.js');
                const api = init(testEyesConfig({ consentRequired: false, autoPageview: false }));
                const first = readEyesId();
                api.page();
                await api.flush();
                const [before] = sentEvents();
                fetchSpy.mockClear();

                clearCookie();
                localStorage.setItem('eyes_consent_revoked', '1');
                api.consent();
                await api.flush();

                const [granted, ...rest] = sentEvents();
                const eyesId = readEyesId();
                expect(eyesId).toBeTruthy();
                expect(eyesId).not.toBe(first);
                expect(localStorage.getItem('eyes_consent_revoked')).toBeNull();
                expect(granted).toMatchObject({ type: 'consent_granted', eyesId });
                expect(granted?.sessionId).not.toBe(before?.sessionId);
                expect(granted?.pageLoadId).not.toBe(before?.pageLoadId);
                expect(rest).toEqual([]);

                await api.shutdown();
            });

            it('stays dropped on a browser that opted out there', async () => {
                setCookie('from-another-tab');
                const api = await startTracker();
                api.page();
                await api.flush();
                fetchSpy.mockClear();

                clearCookie();
                localStorage.setItem('eyes_optout', '1');
                api.consent();
                api.track('next');
                setVisibility('hidden');
                await vi.advanceTimersByTimeAsync(0);

                expect(sentEvents()).toEqual([]);
                expect(readEyesId()).toBeNull();

                await api.shutdown();
            });
        });

        it('sends nothing new when consent() is replayed while the cookie is there', async () => {
            setCookie('from-another-tab');
            const api = await startTracker();
            api.page();
            api.consent();
            api.page();
            await api.flush();

            const [first, second, ...rest] = sentEvents();
            expect(second).toMatchObject({
                type: 'pageview',
                eyesId: 'from-another-tab',
                sessionId: first?.sessionId,
                pageLoadId: first?.pageLoadId,
            });
            expect(rest).toEqual([]);
            expect(readEyesId()).toBe('from-another-tab');

            await api.shutdown();
        });
    });
});

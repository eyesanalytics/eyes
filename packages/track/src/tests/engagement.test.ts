import type { EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EyesTracker } from '~/core';
import { initEngagement } from '~/engagement';
import {
    getPageLoadId,
    getSessionId,
    leaveVisit,
    resetSession,
    SESSION_TIMEOUT_MS,
    touchSession,
} from '~/session';
import { TEST_SITE_ID, testEyesConfig } from '~/tests/helpers';

const noopLogger = { info: vi.fn(), event: vi.fn(), warn: vi.fn() };

// EyesTracker has private members, so mock objects can't structurally match it
const asTracker = (mock: ReturnType<typeof makeTracker>) => mock as unknown as EyesTracker;

const makeTracker = () => {
    const sent: EyesEvent[] = [];
    return {
        page: vi.fn(),
        send: vi.fn((e: EyesEvent) => sent.push(e)),
        eventEyesId: vi.fn<() => string | undefined>(),
        currentUrl: vi.fn(() => location.href),
        track: vi.fn(),
        config: testEyesConfig({ endpoint: 'https://test.com', siteId: TEST_SITE_ID }),
        _sent: sent,
    };
};

describe('engagement', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
            writable: true,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('starts active time when page is visible on init', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);

        // Advance time by 2 seconds while "visible"
        vi.advanceTimersByTime(2000);

        // Trigger engagement send by hiding the page
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(tracker.send).toHaveBeenCalled();
        const event = tracker.send.mock.calls[0][0] as EyesEvent;
        expect(event.type).toBe('engagement');
        expect(event.activeTime).toBeGreaterThanOrEqual(2000);

        cleanup();
    });

    it('sends engagement on pagehide, once, when the page is left', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);

        vi.advanceTimersByTime(3000);

        // A navigation fires pagehide first, then visibilitychange to hidden
        window.dispatchEvent(new Event('pagehide'));
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(tracker.send).toHaveBeenCalledOnce();
        expect((tracker.send.mock.calls[0][0] as EyesEvent).activeTime).toBeGreaterThanOrEqual(
            3000,
        );

        cleanup();
    });

    it('sends again after a later hide only when engagement grew', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);
        const setVisibility = (value: 'visible' | 'hidden') => {
            Object.defineProperty(document, 'visibilityState', {
                value,
                configurable: true,
                writable: true,
            });
            document.dispatchEvent(new Event('visibilitychange'));
        };

        vi.advanceTimersByTime(2000);
        setVisibility('hidden');
        setVisibility('visible');
        setVisibility('hidden');
        expect(tracker.send).toHaveBeenCalledOnce();

        setVisibility('visible');
        vi.advanceTimersByTime(2000);
        window.dispatchEvent(new Event('pagehide'));
        expect(tracker.send).toHaveBeenCalledTimes(2);
        expect((tracker.send.mock.calls[1][0] as EyesEvent).activeTime).toBeGreaterThanOrEqual(
            4000,
        );

        cleanup();
    });

    it('does not send engagement when activeTime < 1s and no scroll', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);

        // Only 500ms of activity
        vi.advanceTimersByTime(500);

        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(tracker.send).not.toHaveBeenCalled();

        cleanup();
    });

    it('stops accumulating time on blur and resumes on focus', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);

        // Active for 1s
        vi.advanceTimersByTime(1000);

        // Blur, timer stops
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(5000); // 5s idle, shouldn't count

        // Focus, timer resumes
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(1000);

        // Send engagement
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        const event = tracker.send.mock.calls[0][0] as EyesEvent;
        // Should be ~2000ms (1s before blur + 1s after focus), not 7s
        expect(event.activeTime).toBeGreaterThanOrEqual(2000);
        expect(event.activeTime).toBeLessThan(3000);

        cleanup();
    });

    describe('idle limit', () => {
        const MINUTE = 60_000;

        const setVisibility = (value: 'visible' | 'hidden') => {
            Object.defineProperty(document, 'visibilityState', {
                value,
                configurable: true,
                writable: true,
            });
            document.dispatchEvent(new Event('visibilitychange'));
        };

        const reported = (tracker: ReturnType<typeof makeTracker>) =>
            tracker.send.mock.calls.map(([event]) => ({
                sessionId: event.sessionId,
                activeTime: event.activeTime,
            }));

        beforeEach(() => {
            resetSession();
        });

        it('stops counting 30 minutes after the last input', () => {
            const tracker = makeTracker();
            const session = touchSession();
            const cleanup = initEngagement(asTracker(tracker), noopLogger);

            vi.advanceTimersByTime(180 * MINUTE);
            setVisibility('hidden');

            expect(reported(tracker)).toEqual([{ sessionId: session, activeTime: 30 * MINUTE }]);

            cleanup();
        });

        it('keeps counting while input arrives within 30 minutes', () => {
            const tracker = makeTracker();
            touchSession();
            const cleanup = initEngagement(asTracker(tracker), noopLogger);

            for (let i = 0; i < 6; i++) {
                vi.advanceTimersByTime(10 * MINUTE);
                touchSession();
            }
            setVisibility('hidden');

            expect(reported(tracker).map(({ activeTime }) => activeTime)).toEqual([60 * MINUTE]);

            cleanup();
        });

        it('counts from the page load when there was no input', () => {
            const tracker = makeTracker();
            const cleanup = initEngagement(asTracker(tracker), noopLogger);

            // Focus is not input: after 10 minutes in another window, the 10 minutes left before
            // the limit count, not 30 from the moment the window came back.
            vi.advanceTimersByTime(10 * MINUTE);
            window.dispatchEvent(new Event('blur'));
            vi.advanceTimersByTime(10 * MINUTE);
            window.dispatchEvent(new Event('focus'));
            vi.advanceTimersByTime(180 * MINUTE);
            setVisibility('hidden');

            expect(reported(tracker).map(({ activeTime }) => activeTime)).toEqual([20 * MINUTE]);

            cleanup();
        });

        it('leaves out hidden time and counts from the return to the tab', () => {
            const tracker = makeTracker();
            touchSession();
            const cleanup = initEngagement(asTracker(tracker), noopLogger);

            vi.advanceTimersByTime(5 * MINUTE);
            setVisibility('hidden');
            vi.advanceTimersByTime(10 * MINUTE);

            // Coming back to the tab is activity (see activity.ts)
            setVisibility('visible');
            touchSession();
            vi.advanceTimersByTime(180 * MINUTE);
            setVisibility('hidden');

            expect(reported(tracker).map(({ activeTime }) => activeTime)).toEqual([
                5 * MINUTE,
                35 * MINUTE,
            ]);

            cleanup();
        });

        it('files 30 minutes on the ended visit when input arrives after the limit', () => {
            const tracker = makeTracker();
            tracker.page.mockImplementation(() => touchSession());
            const start = Date.now();
            const idle = touchSession(start);
            const cleanup = initEngagement(asTracker(tracker), noopLogger);

            vi.advanceTimersByTime(180 * MINUTE);
            const next = touchSession();

            expect(next).not.toBe(idle);
            expect(tracker.send).toHaveBeenCalledOnce();
            expect(tracker.send.mock.calls[0][0]).toMatchObject({
                sessionId: idle,
                timestamp: start,
                activeTime: 30 * MINUTE,
            });

            // The rest of this page stays with the ended visit; the next page counts again.
            vi.advanceTimersByTime(10 * MINUTE);
            tracker.page();
            vi.advanceTimersByTime(10 * MINUTE);
            setVisibility('hidden');

            expect(reported(tracker)).toEqual([
                { sessionId: idle, activeTime: 30 * MINUTE },
                { sessionId: next, activeTime: 10 * MINUTE },
            ]);

            cleanup();
        });

        it('counts each SPA page up to 30 minutes after its own navigation', () => {
            const tracker = makeTracker();
            tracker.page.mockImplementation(() => touchSession());
            const session = touchSession();
            const cleanup = initEngagement(asTracker(tracker), noopLogger);

            vi.advanceTimersByTime(10 * MINUTE);
            tracker.page();
            vi.advanceTimersByTime(180 * MINUTE);
            setVisibility('hidden');

            expect(reported(tracker)).toEqual([
                { sessionId: session, activeTime: 10 * MINUTE },
                { sessionId: session, activeTime: 30 * MINUTE },
            ]);

            cleanup();
        });
    });

    it('wraps tracker.page to flush engagement on SPA navigation', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);

        // Accumulate some time
        vi.advanceTimersByTime(2000);

        // Simulate SPA navigation, engagement calls the wrapped page()
        tracker.page();

        // The engagement for the previous page should have been sent
        expect(tracker.send).toHaveBeenCalled();
        const event = tracker.send.mock.calls[0][0] as EyesEvent;
        expect(event.type).toBe('engagement');

        cleanup();
    });

    it('resets counters after SPA navigation', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);

        // Accumulate 2s on first page
        vi.advanceTimersByTime(2000);

        // Navigate to new page
        tracker.page();
        tracker.send.mockClear();

        // Only 500ms on second page, no scroll
        vi.advanceTimersByTime(500);

        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        // Should NOT send engagement for the new page (< 1s, no scroll)
        expect(tracker.send).not.toHaveBeenCalled();

        cleanup();
    });

    it('sends engagement on cleanup', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);

        vi.advanceTimersByTime(2000);
        cleanup();

        expect(tracker.send).toHaveBeenCalled();
        const event = tracker.send.mock.calls[0][0] as EyesEvent;
        expect(event.type).toBe('engagement');
    });

    it('restores original tracker.page on cleanup', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);

        // page should be wrapped (engagement replaces it)
        const wrappedPage = tracker.page;

        cleanup();

        // After cleanup, page should no longer be the wrapped version
        // The original is stored via .bind(), so we verify it changed back
        expect(tracker.page).not.toBe(wrappedPage);
    });

    it('files engagement on the ended session when activity after idling starts a new one', () => {
        resetSession();
        const tracker = makeTracker();
        tracker.page.mockImplementation(() => touchSession());
        const cleanup = initEngagement(asTracker(tracker), noopLogger);
        const start = Date.now();
        const idle = touchSession(start);

        vi.advanceTimersByTime(SESSION_TIMEOUT_MS + 60_000);
        const next = touchSession();

        expect(tracker.send).toHaveBeenCalledOnce();
        const event = tracker.send.mock.calls[0][0] as EyesEvent;
        expect(event.sessionId).toBe(idle);
        expect(event.timestamp).toBe(start);
        expect(next).not.toBe(idle);

        // The page belongs to the ended visit, so leaving it reports nothing on the new session.
        vi.advanceTimersByTime(5000);
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(tracker.send).toHaveBeenCalledOnce();

        // The next pageview is reported again, on the new session.
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
            writable: true,
        });
        tracker.page();
        vi.advanceTimersByTime(2000);
        cleanup();

        expect(tracker.send).toHaveBeenCalledTimes(2);
        expect((tracker.send.mock.calls[1][0] as EyesEvent).sessionId).toBe(getSessionId());
        expect(getSessionId()).toBe(next);
    });

    describe('when the page leaves its visit', () => {
        const hide = () => {
            Object.defineProperty(document, 'visibilityState', {
                value: 'hidden',
                configurable: true,
                writable: true,
            });
            document.dispatchEvent(new Event('visibilitychange'));
        };

        it('files the engagement on the visit while it can take it, then ends it', () => {
            const tracker = makeTracker();
            tracker.page.mockImplementation(() => touchSession());
            const cleanup = initEngagement(asTracker(tracker), noopLogger);
            const session = touchSession();
            const pageLoad = getPageLoadId();

            vi.advanceTimersByTime(2000);
            leaveVisit(true);

            expect(tracker.send).toHaveBeenCalledOnce();
            expect(tracker.send.mock.calls[0][0]).toMatchObject({
                type: 'engagement',
                sessionId: session,
                pageLoadId: pageLoad,
            });

            vi.advanceTimersByTime(2000);
            hide();
            expect(tracker.send).toHaveBeenCalledOnce();

            // The next pageview is reported again, on the new session and page load.
            Object.defineProperty(document, 'visibilityState', {
                value: 'visible',
                configurable: true,
                writable: true,
            });
            tracker.page();
            vi.advanceTimersByTime(2000);
            cleanup();

            expect(tracker.send).toHaveBeenCalledTimes(2);
            const next = tracker.send.mock.calls[1][0] as EyesEvent;
            expect(next.sessionId).toBe(getSessionId());
            expect(next.sessionId).not.toBe(session);
            expect(next.pageLoadId).not.toBe(pageLoad);
        });

        it('ends it without sending when the visit can no longer take it', () => {
            const tracker = makeTracker();
            const cleanup = initEngagement(asTracker(tracker), noopLogger);

            vi.advanceTimersByTime(2000);
            leaveVisit(false);
            hide();
            cleanup();

            expect(tracker.send).not.toHaveBeenCalled();
        });

        it('leaves before it builds the event once the eyes_id has gone', () => {
            const tracker = makeTracker();
            tracker.eventEyesId.mockImplementation(() => {
                leaveVisit(false);
                return undefined;
            });
            const cleanup = initEngagement(asTracker(tracker), noopLogger);

            vi.advanceTimersByTime(2000);
            hide();
            cleanup();

            expect(tracker.send).not.toHaveBeenCalled();
        });
    });

    it('keeps reporting a pageview whose own activity expired the session', () => {
        resetSession();
        const tracker = makeTracker();
        tracker.page.mockImplementation(() => touchSession());
        const cleanup = initEngagement(asTracker(tracker), noopLogger);
        touchSession(Date.now());

        vi.advanceTimersByTime(SESSION_TIMEOUT_MS + 60_000);
        tracker.page();
        tracker.send.mockClear();

        vi.advanceTimersByTime(2000);
        cleanup();

        expect(tracker.send).toHaveBeenCalledOnce();
        expect((tracker.send.mock.calls[0][0] as EyesEvent).sessionId).toBe(getSessionId());
    });

    it('includes scroll depth in the engagement event', () => {
        const tracker = makeTracker();
        const cleanup = initEngagement(asTracker(tracker), noopLogger);

        // Mock scroll dimensions
        Object.defineProperty(document.documentElement, 'scrollHeight', {
            value: 2000,
            configurable: true,
        });
        Object.defineProperty(window, 'innerHeight', {
            value: 500,
            configurable: true,
        });
        Object.defineProperty(window, 'scrollY', {
            value: 750,
            configurable: true,
            writable: true,
        });

        // Dispatch scroll to trigger depth tracking
        window.dispatchEvent(new Event('scroll'));
        // The scroll handler is throttled at 200ms
        vi.advanceTimersByTime(200);

        // Also need enough active time
        vi.advanceTimersByTime(2000);

        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(tracker.send).toHaveBeenCalled();
        const event = tracker.send.mock.calls[0][0] as EyesEvent;
        expect(event.scrollDepth).toBe(50); // 750 / (2000 - 500) = 0.5 → 50%

        cleanup();
    });
});

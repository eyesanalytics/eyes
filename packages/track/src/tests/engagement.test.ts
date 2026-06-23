import type { EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EyesTracker } from '~/core';
import { initEngagement } from '~/engagement';
import { TEST_SITE_ID, testEyesConfig } from '~/tests/helpers';

const noopLogger = { info: vi.fn(), event: vi.fn(), warn: vi.fn() };

// EyesTracker has private members, so mock objects can't structurally match it
const asTracker = (mock: ReturnType<typeof makeTracker>) => mock as unknown as EyesTracker;

const makeTracker = () => {
    const sent: EyesEvent[] = [];
    return {
        page: vi.fn(),
        send: vi.fn((e: EyesEvent) => sent.push(e)),
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

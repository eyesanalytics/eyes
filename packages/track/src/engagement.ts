import type { EyesEvent } from 'eyes-types';
import type { EyesTracker } from '~/core';
import { getSessionId } from '~/session';
import type { Logger } from '~/utils/logger';
import { throttle } from '~/utils/throttle';

/**
 * Track per-pageview engagement metrics:
 * - **Scroll depth**: maximum scroll position as a percentage (0-100)
 * - **Active time**: cumulative milliseconds the page was visible + focused
 *
 * Sends an `engagement` event on page hide or SPA navigation.
 * Returns a cleanup function.
 */
const initEngagement = (tracker: EyesTracker, logger: Logger): (() => void) => {
    let maxScrollDepth = 0;
    let activeTimeStart: number | null = null;
    let totalActiveTime = 0;
    let pageUrl = tracker.currentUrl();
    let hasSentForCurrentPage = false;

    // -----------------------------------------------------------------
    // Scroll depth
    // -----------------------------------------------------------------
    const getScrollPercent = (): number => {
        const scrollHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        if (scrollHeight <= viewportHeight) return 100;
        return Math.min(100, Math.round((window.scrollY / (scrollHeight - viewportHeight)) * 100));
    };

    const onScroll = throttle(() => {
        const depth = getScrollPercent();
        if (depth > maxScrollDepth) maxScrollDepth = depth;
    }, 200);

    // -----------------------------------------------------------------
    // Active time, accumulate while visible + focused
    // -----------------------------------------------------------------
    const startTimer = (): void => {
        if (activeTimeStart === null) {
            activeTimeStart = Date.now();
        }
    };

    const stopTimer = (): void => {
        if (activeTimeStart !== null) {
            totalActiveTime += Date.now() - activeTimeStart;
            activeTimeStart = null;
        }
    };

    const onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') {
            stopTimer();
            sendEngagement();
            return;
        }
        startTimer();
    };

    const onFocus = (): void => {
        if (document.visibilityState === 'visible') startTimer();
    };

    const onBlur = (): void => {
        stopTimer();
    };

    // -----------------------------------------------------------------
    // Send engagement event
    // -----------------------------------------------------------------
    const sendEngagement = (): void => {
        stopTimer();
        if (totalActiveTime < 1000 && maxScrollDepth === 0) return;
        if (hasSentForCurrentPage && maxScrollDepth === 0) return;

        const event: EyesEvent = {
            type: 'engagement',
            url: pageUrl,
            sessionId: getSessionId(),
            timestamp: Date.now(),
            scrollDepth: maxScrollDepth,
            activeTime: totalActiveTime,
        };

        logger.event('engagement', {
            url: pageUrl,
            scrollDepth: `${maxScrollDepth}%`,
            activeTime: `${totalActiveTime}ms`,
        });

        tracker.send(event);
        hasSentForCurrentPage = true;
    };

    // -----------------------------------------------------------------
    // Reset on new pageview (called by Capture on SPA nav)
    // -----------------------------------------------------------------
    const originalPage = tracker.page.bind(tracker);
    tracker.page = props => {
        // Flush engagement for the previous page
        sendEngagement();

        // Reset for new page
        maxScrollDepth = 0;
        totalActiveTime = 0;
        activeTimeStart = null;
        hasSentForCurrentPage = false;
        pageUrl = tracker.currentUrl();

        // Track the actual pageview
        originalPage(props);

        // Start active time for new page
        if (document.visibilityState === 'visible') startTimer();
    };

    // -----------------------------------------------------------------
    // Listeners
    // -----------------------------------------------------------------

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    // Start active time if page is currently visible
    if (document.visibilityState === 'visible') startTimer();

    return () => {
        sendEngagement();
        window.removeEventListener('scroll', onScroll);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        tracker.page = originalPage;
    };
};

export { initEngagement };

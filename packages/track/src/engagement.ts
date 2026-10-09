import type { EyesEvent } from 'eyes-types';
import type { EyesTracker } from '~/core';
import { getSessionId, onSessionExpire, sessionTimestamp } from '~/session';
import type { Logger } from '~/utils/logger';
import { throttle } from '~/utils/throttle';

/**
 * Track per-pageview engagement metrics:
 * - **Scroll depth**: maximum scroll position as a percentage (0-100)
 * - **Active time**: cumulative milliseconds the page was visible + focused
 *
 * Sends an `engagement` event on page hide (the first of `pagehide` and `visibilitychange`) or SPA
 * navigation. Values are cumulative for the page, so a page left after a tab switch reports its
 * total again only when it grew.
 * Returns a cleanup function.
 */
const initEngagement = (tracker: EyesTracker, logger: Logger): (() => void) => {
    let maxScrollDepth = 0;
    let activeTimeStart: number | null = null;
    let totalActiveTime = 0;
    let pageUrl = tracker.currentUrl();
    let sent = { activeTime: 0, scrollDepth: 0 };
    // pagehide and visibilitychange both fire when a page is left; send once per hidden period.
    let sentWhileHidden = false;
    // Once the session expires the page's engagement belongs to the ended visit. Reporting more of
    // it would open the new session with engagement but no pageview.
    let ended = false;

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

    const onHide = (): void => {
        if (sentWhileHidden) return;
        sentWhileHidden = true;
        sendEngagement();
    };

    const onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') {
            onHide();
            return;
        }
        sentWhileHidden = false;
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
        if (ended) return;
        if (totalActiveTime < 1000 && maxScrollDepth === 0) return;
        if (totalActiveTime <= sent.activeTime && maxScrollDepth <= sent.scrollDepth) return;

        const event: EyesEvent = {
            type: 'engagement',
            url: pageUrl,
            sessionId: getSessionId(),
            timestamp: sessionTimestamp(),
            scrollDepth: maxScrollDepth,
            activeTime: totalActiveTime,
        };

        logger.event('engagement', {
            url: pageUrl,
            scrollDepth: `${maxScrollDepth}%`,
            activeTime: `${totalActiveTime}ms`,
        });

        tracker.send(event);
        sent = { activeTime: totalActiveTime, scrollDepth: maxScrollDepth };
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
        sent = { activeTime: 0, scrollDepth: 0 };
        pageUrl = tracker.currentUrl();

        // Track the actual pageview. Its activity may expire the session, which ends the reset
        // page, so mark the new page live only afterwards.
        originalPage(props);
        ended = false;

        // Start active time for new page
        if (document.visibilityState === 'visible') startTimer();
    };

    // -----------------------------------------------------------------
    // Session expiry: file the ended visit's engagement on its own session
    // -----------------------------------------------------------------
    const offSessionExpire = onSessionExpire(() => {
        sendEngagement();
        ended = true;
    });

    // -----------------------------------------------------------------
    // Listeners
    // -----------------------------------------------------------------

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    // Start active time if page is currently visible
    if (document.visibilityState === 'visible') startTimer();

    return () => {
        sendEngagement();
        offSessionExpire();
        window.removeEventListener('scroll', onScroll);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        tracker.page = originalPage;
    };
};

export { initEngagement };

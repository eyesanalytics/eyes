import type { EyesEvent } from 'eyes-types';
import type { EyesTracker } from '~/core';
import {
    getLastActivityAt,
    getPageLoadId,
    getSessionId,
    onSessionExpire,
    onVisitLeave,
    SESSION_TIMEOUT_MS,
    sessionTimestamp,
} from '~/session';
import type { Logger } from '~/utils/logger';
import { throttle } from '~/utils/throttle';

/**
 * Track per-pageview engagement metrics:
 * - **Scroll depth**: maximum scroll position as a percentage (0-100)
 * - **Active time**: cumulative milliseconds the page was visible + focused, until 30 minutes
 *   after the last activity (input, a pageview or an event), or after the page load when there
 *   was none. That is the session timeout: a focused tab nobody uses stops counting where its
 *   visit ends, and the input that wakes it starts a new visit.
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
    // Once the session expires, or the page leaves its visit, the page's engagement belongs to the
    // visit that ended. Reporting more of it would open the new session with engagement but no
    // pageview.
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
    // Active time, accumulate while visible + focused, until the visitor has been idle for the
    // session timeout
    // -----------------------------------------------------------------
    // Before any activity, the page load is the last time the visitor was seen.
    const loadedAt = Date.now();

    const startTimer = (): void => {
        if (activeTimeStart === null) {
            activeTimeStart = Date.now();
        }
    };

    const stopTimer = (): void => {
        if (activeTimeStart !== null) {
            // Input after the limit expires the session, and its listener stops the timer before
            // that input moves the last activity, so the idle gap before it is not counted.
            const idleAt = (getLastActivityAt() ?? loadedAt) + SESSION_TIMEOUT_MS;
            totalActiveTime += Math.max(0, Math.min(Date.now(), idleAt) - activeTimeStart);
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
        // Read first: once the eyes_id has gone, the page leaves its visit, which ends its engagement
        const eyesId = tracker.eventEyesId();
        if (ended) return;
        if (totalActiveTime < 1000 && maxScrollDepth === 0) return;
        if (totalActiveTime <= sent.activeTime && maxScrollDepth <= sent.scrollDepth) return;

        const event: EyesEvent = {
            type: 'engagement',
            url: pageUrl,
            eyesId,
            sessionId: getSessionId(),
            pageLoadId: getPageLoadId(),
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
    // Leaving the visit: file the engagement on it while it can take it, then end as on expiry
    // -----------------------------------------------------------------
    const offVisitLeave = onVisitLeave(report => {
        if (report) sendEngagement();
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
        offVisitLeave();
        window.removeEventListener('scroll', onScroll);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        tracker.page = originalPage;
    };
};

export { initEngagement };

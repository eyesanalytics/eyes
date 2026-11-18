import { generateId } from '~/utils/generate-id';

/** A visit ends after 30 minutes without activity, the convention of every other analytics tool. */
const SESSION_TIMEOUT_MS: number = 30 * 60 * 1000;

// Called when activity ends an expired session, before the new one replaces it.
const expireListeners = new Set<() => void>();

// Kept in memory only, before and after consent, so all of this ends with the page load. The server
// joins page loads into one visit.
let sessionId: string | null = null;
let lastActivityAt: number | null = null;

let pageLoadId: string | null = null;

/** Get the current session ID, creating one if it doesn't exist. Does not count as activity, so
 * passive events (engagement, vitals) never start or extend a session. */
const getSessionId = (): string => {
    if (!sessionId) sessionId = generateId();

    return sessionId;
};

/** When the visitor was last active (a pageview, a custom event or input), or null before any.
 * Reading it is not activity. */
const getLastActivityAt = (): number | null => lastActivityAt;

/**
 * Run a callback when activity ends an expired session, while the expired session and its last
 * activity time are still current, so passive events still pending for the ended visit (engagement,
 * vitals) are filed on it instead of on the session that replaces it. Returns an unsubscribe
 * function.
 */
const onSessionExpire = (listener: () => void): (() => void) => {
    expireListeners.add(listener);

    return () => {
        expireListeners.delete(listener);
    };
};

/**
 * Record visitor activity (a pageview, a custom event, or input) and return the session it
 * belongs to. After 30 minutes without activity the page starts a new session, so an idle tab
 * does not turn into one endless visit: the server keeps a session id on its visit for hours.
 */
const touchSession = (now: number = Date.now()): string => {
    const expired = lastActivityAt !== null && now - lastActivityAt > SESSION_TIMEOUT_MS;
    if (sessionId && expired) {
        for (const listener of expireListeners) listener();
    }

    const current = sessionId && !expired ? sessionId : generateId();
    sessionId = current;
    lastActivityAt = now;

    return current;
};

/**
 * Timestamp for a passive event. Once the session has expired, the visit ended at its last
 * activity: stamping an engagement or vitals row sent when a long-idle tab is finally closed
 * with the current time would add the idle time to the session's duration.
 */
const sessionTimestamp = (now: number = Date.now()): number => {
    if (lastActivityAt !== null && now - lastActivityAt > SESSION_TIMEOUT_MS) return lastActivityAt;

    return now;
};

/**
 * The id of this page load, the same for every event the document sends until it leaves its visit,
 * and never stored. The server files engagement and vitals on the visit this page load's pageview
 * joined.
 */
const getPageLoadId = (): string => {
    if (!pageLoadId) pageLoadId = generateId();

    return pageLoadId;
};

/** Clear and regenerate the session ID. */
const resetSession = (): string => {
    sessionId = null;
    lastActivityAt = null;

    return getSessionId();
};

// Called when the page leaves its visit, before a new session and page load replace it.
const leaveListeners = new Set<(report: boolean) => void>();

/**
 * Run a callback when the page leaves its visit, while the visit's session and page load are still
 * current. `report` says whether passive events still pending for the visit (engagement, vitals)
 * may be filed on it. When they may not, they are dropped: the session that follows has no
 * pageview to carry them. Returns an unsubscribe function.
 */
const onVisitLeave = (listener: (report: boolean) => void): (() => void) => {
    leaveListeners.add(listener);

    return () => {
        leaveListeners.delete(listener);
    };
};

/**
 * Leave the visit at once: listeners run first, then a new session and a new page load id start,
 * so nothing the page sends from now on leads the server back to the visit it was in.
 */
const leaveVisit = (report: boolean): void => {
    for (const listener of leaveListeners) listener(report);

    sessionId = null;
    lastActivityAt = null;
    pageLoadId = null;
};

export {
    getLastActivityAt,
    getPageLoadId,
    getSessionId,
    leaveVisit,
    onSessionExpire,
    onVisitLeave,
    resetSession,
    SESSION_TIMEOUT_MS,
    sessionTimestamp,
    touchSession,
};

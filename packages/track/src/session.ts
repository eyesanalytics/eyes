import { generateId } from '~/utils/generate-id';

const SESSION_KEY = 'eyes_sid';
const ACTIVITY_KEY = 'eyes_sid_at';

/** A visit ends after 30 minutes without activity, the convention of every other analytics tool. */
const SESSION_TIMEOUT_MS: number = 30 * 60 * 1000;

// Called when activity ends an expired session, before the new one replaces it.
const expireListeners = new Set<() => void>();

// Used when sessionStorage is unavailable, so one page load still keeps one session.
let memory: { id: string; at: number | null } | null = null;

const read = (): { id: string | null; at: number | null } => {
    try {
        const at = Number(sessionStorage.getItem(ACTIVITY_KEY));

        return { id: sessionStorage.getItem(SESSION_KEY), at: at > 0 ? at : null };
    } catch {
        return { id: memory?.id ?? null, at: memory?.at ?? null };
    }
};

const write = (id: string, at: number | null): void => {
    memory = { id, at: at ?? memory?.at ?? null };
    try {
        sessionStorage.setItem(SESSION_KEY, id);
        if (at !== null) sessionStorage.setItem(ACTIVITY_KEY, String(at));
    } catch {
        // sessionStorage unavailable (e.g. private browsing in some browsers), keep it in memory
    }
};

/** Get the current session ID, creating one if it doesn't exist. Does not count as activity, so
 * passive events (engagement, vitals) never start or extend a session. */
const getSessionId = (): string => {
    const { id, at } = read();
    if (id) return id;

    const created = generateId();
    write(created, at);

    return created;
};

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
 * belongs to. After 30 minutes without activity the tab starts a new session, so an idle tab
 * does not turn into one endless visit.
 */
const touchSession = (now: number = Date.now()): string => {
    const { id, at } = read();
    const expired = at !== null && now - at > SESSION_TIMEOUT_MS;
    if (id && expired) {
        for (const listener of expireListeners) listener();
    }

    const current = id && !expired ? id : generateId();
    write(current, now);

    return current;
};

/**
 * Timestamp for a passive event. Once the session has expired, the visit ended at its last
 * activity: stamping an engagement or vitals row sent when a long-idle tab is finally closed
 * with the current time would add the idle time to the session's duration.
 */
const sessionTimestamp = (now: number = Date.now()): number => {
    const { at } = read();
    if (at !== null && now - at > SESSION_TIMEOUT_MS) return at;

    return now;
};

/** Clear and regenerate the session ID. */
const resetSession = (): string => {
    memory = null;
    try {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(ACTIVITY_KEY);
    } catch {
        // Ignore, we'll generate a fresh ID regardless
    }
    return getSessionId();
};

export {
    getSessionId,
    onSessionExpire,
    resetSession,
    SESSION_TIMEOUT_MS,
    sessionTimestamp,
    touchSession,
};

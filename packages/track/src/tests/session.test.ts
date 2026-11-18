import { beforeEach, describe, expect, it } from 'vitest';
import {
    getPageLoadId,
    getSessionId,
    leaveVisit,
    onSessionExpire,
    onVisitLeave,
    resetSession,
    SESSION_TIMEOUT_MS,
    sessionTimestamp,
    touchSession,
} from '~/session';

describe('session', () => {
    beforeEach(() => {
        resetSession();
        sessionStorage.clear();
    });

    it('creates a session ID without storing it', () => {
        const id = getSessionId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
        touchSession();
        expect(sessionStorage).toHaveLength(0);
    });

    it('returns the same ID on subsequent calls', () => {
        const first = getSessionId();
        const second = getSessionId();
        expect(first).toBe(second);
    });

    it('returns a valid UUID', () => {
        const id = getSessionId();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    describe('inactivity timeout', () => {
        it('keeps the session while there is activity within 30 minutes', () => {
            const start = 1_790_000_000_000;
            const first = touchSession(start);
            expect(touchSession(start + SESSION_TIMEOUT_MS)).toBe(first);
            expect(touchSession(start + 2 * SESSION_TIMEOUT_MS)).toBe(first);
        });

        it('starts a new session on activity after 30 minutes without any', () => {
            const start = 1_790_000_000_000;
            const first = touchSession(start);
            const next = touchSession(start + SESSION_TIMEOUT_MS + 1);
            expect(next).not.toBe(first);
            expect(getSessionId()).toBe(next);
        });

        it('does not let passive reads start or extend a session', () => {
            const start = 1_790_000_000_000;
            const first = touchSession(start);
            expect(getSessionId()).toBe(first);
            expect(sessionTimestamp(start + SESSION_TIMEOUT_MS + 1)).toBe(start);
        });

        it('lets listeners see the expired session before activity replaces it', () => {
            const start = 1_790_000_000_000;
            const first = touchSession(start);
            const seen: { id: string; at: number }[] = [];
            const off = onSessionExpire(() =>
                seen.push({
                    id: getSessionId(),
                    at: sessionTimestamp(start + 3 * SESSION_TIMEOUT_MS),
                }),
            );

            touchSession(start + SESSION_TIMEOUT_MS);
            expect(seen).toEqual([]);

            const next = touchSession(start + 3 * SESSION_TIMEOUT_MS);
            expect(seen).toEqual([{ id: first, at: start + SESSION_TIMEOUT_MS }]);
            expect(next).not.toBe(first);

            off();
            touchSession(start + 5 * SESSION_TIMEOUT_MS);
            expect(seen).toHaveLength(1);
        });

        it('stamps passive events with the last activity once the session expired', () => {
            const start = 1_790_000_000_000;
            touchSession(start);
            expect(sessionTimestamp(start + 60_000)).toBe(start + 60_000);
            expect(sessionTimestamp(start + SESSION_TIMEOUT_MS + 60_000)).toBe(start);
        });
    });

    describe('resetSession', () => {
        it('generates a new session ID', () => {
            const first = getSessionId();
            const second = resetSession();
            expect(second).not.toBe(first);
        });

        it('forgets the last activity of the old session', () => {
            const start = 1_790_000_000_000;
            touchSession(start);
            resetSession();
            expect(sessionTimestamp(start + 2 * SESSION_TIMEOUT_MS)).toBe(
                start + 2 * SESSION_TIMEOUT_MS,
            );
        });
    });

    describe('getPageLoadId', () => {
        it('keeps one id for the page load without storing it', () => {
            const id = getPageLoadId();
            expect(id).toMatch(/^[0-9a-f-]{36}$/);
            expect(getPageLoadId()).toBe(id);
            expect(Object.values({ ...sessionStorage })).not.toContain(id);
        });

        it('outlives a reset or an expired session, which do not start a new page load', () => {
            const id = getPageLoadId();
            resetSession();
            touchSession(Date.now() + 2 * SESSION_TIMEOUT_MS);
            expect(getPageLoadId()).toBe(id);
        });
    });

    describe('leaveVisit', () => {
        it('starts a new session and page load after listeners saw the old ones', () => {
            const session = touchSession();
            const pageLoad = getPageLoadId();
            const seen: { report: boolean; session: string; pageLoad: string }[] = [];
            const off = onVisitLeave(report =>
                seen.push({ report, session: getSessionId(), pageLoad: getPageLoadId() }),
            );

            leaveVisit(true);

            expect(seen).toEqual([{ report: true, session, pageLoad }]);
            expect(getSessionId()).not.toBe(session);
            expect(getPageLoadId()).not.toBe(pageLoad);

            off();
            leaveVisit(false);
            expect(seen).toHaveLength(1);
        });

        it('forgets the last activity of the visit it leaves', () => {
            const start = 1_790_000_000_000;
            touchSession(start);
            leaveVisit(false);
            expect(sessionTimestamp(start + 2 * SESSION_TIMEOUT_MS)).toBe(
                start + 2 * SESSION_TIMEOUT_MS,
            );
        });
    });
});

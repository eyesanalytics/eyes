import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionId, resetSession } from '~/session';

describe('session', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('creates and persists a session ID', () => {
        const id = getSessionId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
        expect(sessionStorage.getItem('eyes_sid')).toBe(id);
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

    describe('resetSession', () => {
        it('generates a new session ID', () => {
            const first = getSessionId();
            const second = resetSession();
            expect(second).not.toBe(first);
        });

        it('clears the old session from storage', () => {
            getSessionId();
            resetSession();
            // The new ID should be stored
            const stored = sessionStorage.getItem('eyes_sid');
            expect(stored).toBeTruthy();
        });
    });

    describe('when sessionStorage is unavailable', () => {
        it('returns a generated ID without throwing', () => {
            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('SecurityError');
            });
            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('SecurityError');
            });

            const id = getSessionId();
            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(0);

            vi.restoreAllMocks();
        });
    });
});

import type { EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readEyesId = (): string | null => {
    const match = document.cookie.match(/(?:^|; )eyes_id=([^;]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const noopPerformanceObserver = class {
    observe() {}
    disconnect() {}
};

type FetchCall = [string, { body: string }];

const readEventsFromCalls = (calls: unknown[][]): EyesEvent[] => {
    return (calls as FetchCall[]).flatMap(([, { body }]) => JSON.parse(body) as EyesEvent[]);
};

describe('consent', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    const clearCookie = () => {
        // biome-ignore lint/suspicious/noDocumentCookie: We need to manipulate cookies in this test.
        document.cookie = 'eyes_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    };

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();

        fetchSpy = vi.fn().mockResolvedValue(new Response());
        vi.stubGlobal('fetch', fetchSpy);
        vi.stubGlobal('PerformanceObserver', noopPerformanceObserver);

        Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Normal Browser');

        clearCookie();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        clearCookie();
    });

    const importModule = () => import('~/index.js');

    describe('consentRequired: true (consent required)', () => {
        it('does not set eyes_id cookie before consent is granted', async () => {
            const { init } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: true });

            expect(readEyesId()).toBeNull();
        });

        it('events have no eyesId before consent is granted', async () => {
            const { init, track, flush } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: true });

            track('test_event');
            await flush();

            if (fetchSpy.mock.calls.length > 0) {
                const body = JSON.parse(fetchSpy.mock.calls[0][1].body) as EyesEvent[];
                expect(body[0].eyesId).toBeUndefined();
            }
        });

        it('sets eyes_id cookie when consent is granted', async () => {
            const { init, consent } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: true });

            consent();

            expect(readEyesId()).not.toBeNull();
        });

        it('attaches eyesId to events after consent is granted', async () => {
            const { init, consent, track, flush } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: true, autoPageview: false });

            consent();
            track('test_event');
            await flush();

            const allEvents = readEventsFromCalls(fetchSpy.mock.calls);
            const customEvent = allEvents.find(e => e.type === 'event');
            expect(customEvent).toBeDefined();
            expect(customEvent.eyesId).toBeTypeOf('string');
            expect(customEvent.eyesId.length).toBeGreaterThan(0);
        });
    });

    describe('revokeConsent', () => {
        it('removes the eyes_id cookie', async () => {
            const { init, consent, revokeConsent } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: true });

            consent();
            expect(readEyesId()).not.toBeNull();

            revokeConsent();
            expect(readEyesId()).toBeNull();
        });

        it('sends a consent_revoked event with the eyesId', async () => {
            const { init, consent, revokeConsent, flush } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: true, autoPageview: false });

            consent();
            const eyesId = readEyesId();
            expect(eyesId).not.toBeNull();

            revokeConsent();
            await vi.advanceTimersToNextTimerAsync();
            await flush();

            expect(fetchSpy).toHaveBeenCalled();
            const allEvents = readEventsFromCalls(fetchSpy.mock.calls);
            const revokedEvent = allEvents.find(e => e.type === 'consent_revoked');
            expect(revokedEvent).toBeDefined();
            expect(revokedEvent.eyesId).toBe(eyesId);
        });

        it('events have no eyesId after consent is revoked', async () => {
            const { init, consent, revokeConsent, track, flush } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: true });

            consent();
            revokeConsent();
            await flush();
            fetchSpy.mockClear();

            track('after_revoke');
            await flush();

            if (fetchSpy.mock.calls.length > 0) {
                const body = JSON.parse(fetchSpy.mock.calls[0][1].body) as EyesEvent[];
                const afterEvent = body.find(e => e.type === 'event');
                expect(afterEvent?.eyesId).toBeUndefined();
            }
        });

        it('identify() is dropped after consent is revoked', async () => {
            const { init, consent, revokeConsent, identify, flush } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: true });

            consent();
            revokeConsent();
            await flush();
            fetchSpy.mockClear();

            identify({ id: 'u_123', email: 'test@example.com' });
            await flush();

            // No fetch should be made (or no identify event in the batch)
            if (fetchSpy.mock.calls.length > 0) {
                const body = JSON.parse(fetchSpy.mock.calls[0][1].body) as EyesEvent[];
                const identifyEvent = body.find(e => e.type === 'identify');
                expect(identifyEvent).toBeUndefined();
            }
        });
    });

    describe('consentRequired: false (no consent required)', () => {
        it('sets eyes_id cookie immediately on init', async () => {
            const { init } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: false });

            expect(readEyesId()).not.toBeNull();
        });

        it('attaches eyesId to events without explicit consent call', async () => {
            const { init, track, flush } = await importModule();
            init({ endpoint: 'https://example.com', consentRequired: false });

            track('test_event');
            await flush();

            const body = JSON.parse(fetchSpy.mock.calls[0][1].body) as EyesEvent[];
            expect(body[0].eyesId).toBeTypeOf('string');
        });
    });
});

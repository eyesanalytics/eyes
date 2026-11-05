import type { EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testEyesConfig } from '~/tests/helpers';

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
        localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        clearCookie();
        localStorage.clear();
    });

    const importModule = () => import('~/index.js');

    describe('consentRequired: true (consent required)', () => {
        it('does not set eyes_id cookie before consent is granted', async () => {
            const { init } = await importModule();
            init(testEyesConfig({ consentRequired: true }));

            expect(readEyesId()).toBeNull();
        });

        it('events have no eyesId before consent is granted', async () => {
            const { init, track, flush } = await importModule();
            init(testEyesConfig({ consentRequired: true }));

            track('test_event');
            await flush();

            if (fetchSpy.mock.calls.length > 0) {
                const body = JSON.parse(fetchSpy.mock.calls[0][1].body) as EyesEvent[];
                expect(body[0].eyesId).toBeUndefined();
            }
        });

        it('sets eyes_id cookie when consent is granted', async () => {
            const { init, consent } = await importModule();
            init(testEyesConfig({ consentRequired: true }));

            consent();

            expect(readEyesId()).not.toBeNull();
        });

        it('attaches eyesId to events after consent is granted', async () => {
            const { init, consent, track, flush } = await importModule();
            init(testEyesConfig({ consentRequired: true, autoPageview: false }));

            consent();
            track('test_event');
            await flush();

            const allEvents = readEventsFromCalls(fetchSpy.mock.calls);
            const customEvent = allEvents.find(e => e.type === 'event');
            expect(customEvent).toBeDefined();
            expect(customEvent.eyesId).toBeTypeOf('string');
            expect(customEvent.eyesId.length).toBeGreaterThan(0);
        });

        it('sends a consent_granted event with the new eyesId', async () => {
            const { init, consent, flush } = await importModule();
            init(testEyesConfig({ consentRequired: true, autoPageview: false }));

            consent();
            await flush();

            const granted = readEventsFromCalls(fetchSpy.mock.calls).filter(
                e => e.type === 'consent_granted',
            );
            expect(granted).toHaveLength(1);
            expect(granted[0].eyesId).toBe(readEyesId());
        });

        it('sends consent_granted only when the state changes', async () => {
            const { init, consent, flush } = await importModule();
            init(testEyesConfig({ consentRequired: true, autoPageview: false }));

            consent();
            consent();
            await flush();

            const granted = readEventsFromCalls(fetchSpy.mock.calls).filter(
                e => e.type === 'consent_granted',
            );
            expect(granted).toHaveLength(1);
        });

        it('does not send consent_granted for a returning visitor who already consented', async () => {
            const first = await importModule();
            first.init(testEyesConfig({ consentRequired: true, autoPageview: false }));
            first.consent();
            await first.flush();
            await first.shutdown();
            fetchSpy.mockClear();

            vi.resetModules();
            const { init, consent, flush } = await importModule();
            init(testEyesConfig({ consentRequired: true, autoPageview: false }));
            consent();
            await flush();

            const granted = readEventsFromCalls(fetchSpy.mock.calls).filter(
                e => e.type === 'consent_granted',
            );
            expect(granted).toHaveLength(0);
        });
    });

    describe('revokeConsent', () => {
        it('removes the eyes_id cookie', async () => {
            const { init, consent, revokeConsent } = await importModule();
            init(testEyesConfig({ consentRequired: true }));

            consent();
            expect(readEyesId()).not.toBeNull();

            revokeConsent();
            expect(readEyesId()).toBeNull();
        });

        it('sends a consent_revoked event with the eyesId', async () => {
            const { init, consent, revokeConsent, flush } = await importModule();
            init(testEyesConfig({ consentRequired: true, autoPageview: false }));

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
            init(testEyesConfig({ consentRequired: true }));

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
            init(testEyesConfig({ consentRequired: true }));

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
            init(testEyesConfig({ consentRequired: false }));

            expect(readEyesId()).not.toBeNull();
        });

        it('attaches eyesId to events without explicit consent call', async () => {
            const { init, track, flush } = await importModule();
            init(testEyesConfig({ consentRequired: false }));

            track('test_event');
            await flush();

            const body = JSON.parse(fetchSpy.mock.calls[0][1].body) as EyesEvent[];
            expect(body[0].eyesId).toBeTypeOf('string');
        });

        it('does not send consent_granted, since consent was never asked for', async () => {
            const { init, consent, flush } = await importModule();
            init(testEyesConfig({ consentRequired: false, autoPageview: false }));

            consent();
            await flush();

            const granted = readEventsFromCalls(fetchSpy.mock.calls).filter(
                e => e.type === 'consent_granted',
            );
            expect(granted).toHaveLength(0);
        });

        it('keeps a withdrawal across page loads instead of setting the cookie again', async () => {
            const first = await importModule();
            first.init(testEyesConfig({ consentRequired: false, autoPageview: false }));
            first.revokeConsent();
            await first.shutdown();
            expect(readEyesId()).toBeNull();
            expect(localStorage.getItem('eyes_consent_revoked')).toBe('1');

            vi.resetModules();
            const { init, track, flush } = await importModule();
            init(testEyesConfig({ consentRequired: false, autoPageview: false }));
            fetchSpy.mockClear();

            track('after_reload');
            await flush();

            expect(readEyesId()).toBeNull();
            const afterEvent = readEventsFromCalls(fetchSpy.mock.calls).find(
                e => e.type === 'event',
            );
            expect(afterEvent).toBeDefined();
            expect(afterEvent?.eyesId).toBeUndefined();
        });

        it('sets the cookie again and clears the withdrawal when consent is given again', async () => {
            const first = await importModule();
            first.init(testEyesConfig({ consentRequired: false, autoPageview: false }));
            first.revokeConsent();
            await first.shutdown();

            vi.resetModules();
            const { init, consent, flush } = await importModule();
            init(testEyesConfig({ consentRequired: false, autoPageview: false }));
            consent();
            await flush();

            expect(readEyesId()).not.toBeNull();
            expect(localStorage.getItem('eyes_consent_revoked')).toBeNull();
            const granted = readEventsFromCalls(fetchSpy.mock.calls).find(
                e => e.type === 'consent_granted',
            );
            expect(granted?.eyesId).toBe(readEyesId());
        });
    });
});

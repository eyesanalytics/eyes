import type { EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '~/config';
import type { EyesTracker } from '~/core';
import { TEST_SITE_ID } from '~/tests/helpers';
import { initVitals } from '~/vitals';

const noopLogger = { info: vi.fn(), event: vi.fn(), warn: vi.fn() };

const makeTracker = () => ({
    send: vi.fn<(event: EyesEvent) => void>(),
    currentUrl: vi.fn(() => 'https://example.com/page'),
    page: vi.fn(),
    track: vi.fn(),
    config: resolveConfig({ endpoint: 'https://test.com', siteId: TEST_SITE_ID }),
});

// EyesTracker has private members, so mock objects can't structurally match it
const asTracker = (mock: ReturnType<typeof makeTracker>) => mock as unknown as EyesTracker;

// Store observer callbacks keyed by entry type so tests can trigger them
type ObserverCallback = (entries: Record<string, unknown>[]) => void;
let observerCallbacks: Map<string, ObserverCallback>;
let mockObservers: Array<{ disconnect: ReturnType<typeof vi.fn> }>;

const setupPerformanceObserverMock = () => {
    observerCallbacks = new Map();
    mockObservers = [];

    vi.stubGlobal(
        'PerformanceObserver',
        class MockPerformanceObserver {
            private callback: PerformanceObserverCallback;
            disconnect = vi.fn();

            constructor(callback: PerformanceObserverCallback) {
                this.callback = callback;
                mockObservers.push(this);
            }

            observe(options: PerformanceObserverInit) {
                const type = options.type;
                if (!type) return;

                observerCallbacks.set(type, entries => {
                    this.callback(
                        { getEntries: () => entries } as unknown as PerformanceObserverEntryList,
                        this as unknown as PerformanceObserver,
                    );
                });
            }
        },
    );
};

const fireEntries = (type: string, entries: Record<string, unknown>[]) => {
    const cb = observerCallbacks.get(type);
    if (cb) cb(entries);
};

describe('vitals', () => {
    beforeEach(() => {
        setupPerformanceObserverMock();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns noop cleanup when PerformanceObserver is undefined', () => {
        vi.stubGlobal('PerformanceObserver', undefined);
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);
        expect(cleanup).toBeTypeOf('function');
        cleanup(); // should not throw
        expect(tracker.send).not.toHaveBeenCalled();
    });

    it('reports TTFB from navigation entries', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);

        expect(tracker.send).toHaveBeenCalledOnce();
        const event: EyesEvent = tracker.send.mock.calls[0][0];
        expect(event.type).toBe('vitals');
        expect(event.metric?.name).toBe('ttfb');
        expect(event.metric?.value).toBe(250);
        expect(event.metric?.rating).toBe('good'); // 250 <= 800

        cleanup();
    });

    it('accounts for activationStart in TTFB', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 1000, activationStart: 200 }]);

        const event: EyesEvent = tracker.send.mock.calls[0][0];
        expect(event.metric?.value).toBe(800); // 1000 - 200

        cleanup();
    });

    it('reports FCP from paint entries', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('paint', [
            { name: 'first-paint', startTime: 500 },
            { name: 'first-contentful-paint', startTime: 1200 },
        ]);

        expect(tracker.send).toHaveBeenCalled();
        const event: EyesEvent = tracker.send.mock.calls[0][0];
        expect(event.metric?.name).toBe('fcp');
        expect(event.metric?.value).toBe(1200);
        expect(event.metric?.rating).toBe('good'); // 1200 <= 1800

        cleanup();
    });

    it('reports LCP on page hide', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('largest-contentful-paint', [
            { startTime: 2000 },
            { startTime: 3200 }, // last entry wins
        ]);

        // LCP isn't reported until page hide
        const lcpCalls = tracker.send.mock.calls.filter(c => c[0].metric?.name === 'lcp');
        expect(lcpCalls).toHaveLength(0);

        // Simulate page hide
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        const lcpAfterHide = tracker.send.mock.calls.filter(c => c[0].metric?.name === 'lcp');
        expect(lcpAfterHide).toHaveLength(1);
        expect(lcpAfterHide[0][0].metric.value).toBe(3200);
        expect(lcpAfterHide[0][0].metric.rating).toBe('needs-improvement'); // 2500 < 3200 <= 4000

        cleanup();
    });

    it('reports LCP on first interaction (keydown)', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('largest-contentful-paint', [{ startTime: 1500 }]);

        window.dispatchEvent(new KeyboardEvent('keydown'));

        const lcpCalls = tracker.send.mock.calls.filter(c => c[0].metric?.name === 'lcp');
        expect(lcpCalls).toHaveLength(1);
        expect(lcpCalls[0][0].metric.value).toBe(1500);

        cleanup();
    });

    it('reports CLS on page hide with correct windowed session value', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        // Fire layout shift entries in a session window
        fireEntries('layout-shift', [
            { hadRecentInput: false, value: 0.05, startTime: 1000 },
            { hadRecentInput: false, value: 0.03, startTime: 1500 }, // within 1s gap, within 5s max
            { hadRecentInput: true, value: 0.5, startTime: 1600 }, // has recent input, ignored
        ]);

        // Trigger page hide
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        const clsCalls = tracker.send.mock.calls.filter(c => c[0].metric?.name === 'cls');
        expect(clsCalls).toHaveLength(1);
        // 0.05 + 0.03 = 0.08
        expect(clsCalls[0][0].metric.value).toBe(0.08);
        expect(clsCalls[0][0].metric.rating).toBe('good'); // 0.08 <= 0.1

        cleanup();
    });

    it('reports INP on page hide as p98 of interaction durations', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        // Fire event entries with interaction IDs
        fireEntries('event', [
            { interactionId: 1, duration: 50, startTime: 100 },
            { interactionId: 2, duration: 120, startTime: 200 },
            { interactionId: 3, duration: 300, startTime: 300 },
        ]);

        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
            writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        const inpCalls = tracker.send.mock.calls.filter(c => c[0].metric?.name === 'inp');
        expect(inpCalls).toHaveLength(1);
        // p98 of [50, 120, 300]: sorted desc = [300, 120, 50], idx = min(2, floor(3/50)) = 0 → 300
        expect(inpCalls[0][0].metric.value).toBe(300);

        cleanup();
    });

    it('does not report the same metric twice', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 200, activationStart: 0 }]);
        fireEntries('navigation', [{ responseStart: 300, activationStart: 0 }]);

        const ttfbCalls = tracker.send.mock.calls.filter(c => c[0].metric?.name === 'ttfb');
        expect(ttfbCalls).toHaveLength(1);
        expect(ttfbCalls[0][0].metric.value).toBe(200); // first report wins

        cleanup();
    });

    it('cleanup disconnects all observers', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        cleanup();

        for (const obs of mockObservers) {
            expect(obs.disconnect).toHaveBeenCalled();
        }
    });

    describe('rate thresholds', () => {
        it.each([
            ['ttfb', 500, 'good'],
            ['ttfb', 800, 'good'],
            ['ttfb', 1200, 'needs-improvement'],
            ['ttfb', 2000, 'poor'],
            ['fcp', 1000, 'good'],
            ['fcp', 2500, 'needs-improvement'],
            ['fcp', 4000, 'poor'],
        ] as const)('%s = %d → %s', (name, value, expectedRating) => {
            const tracker = makeTracker();
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            if (name === 'ttfb') {
                fireEntries('navigation', [{ responseStart: value, activationStart: 0 }]);
            }

            if (name === 'fcp') {
                fireEntries('paint', [{ name: 'first-contentful-paint', startTime: value }]);
            }

            const calls = tracker.send.mock.calls.filter(c => c[0].metric?.name === name);
            expect(calls).toHaveLength(1);
            expect(calls[0][0].metric.rating).toBe(expectedRating);

            cleanup();
        });
    });
});

import type { EyesEvent, VitalMetric, VitalsEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '~/config';
import type { EyesTracker } from '~/core';
import { touchSession } from '~/session';
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
// Chromium's list; Firefox and WebKit leave out layout-shift
let supportedEntryTypes = [
    'navigation',
    'paint',
    'largest-contentful-paint',
    'layout-shift',
    'event',
    'first-input',
];
let mockObservers: Array<{ disconnect: ReturnType<typeof vi.fn> }>;

const setupPerformanceObserverMock = () => {
    observerCallbacks = new Map();
    mockObservers = [];

    vi.stubGlobal(
        'PerformanceObserver',
        class MockPerformanceObserver {
            static supportedEntryTypes = supportedEntryTypes;
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

const setVisibilityState = (value: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', {
        value,
        configurable: true,
        writable: true,
    });
};

// Simulate the page being hidden, which is when vitals are flushed
const hidePage = () => {
    setVisibilityState('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
};

// Extract the single vitals event the tracker should have sent
const sentVitals = (tracker: ReturnType<typeof makeTracker>): VitalsEvent => {
    expect(tracker.send).toHaveBeenCalledOnce();
    const event = tracker.send.mock.calls[0][0];
    expect(event.type).toBe('vitals');
    return event as VitalsEvent;
};

const metric = (event: VitalsEvent, name: string): VitalMetric | undefined =>
    event.metrics.find(m => m.name === name);

describe('vitals', () => {
    beforeEach(() => {
        setupPerformanceObserverMock();
        sessionStorage.clear();
        setVisibilityState('visible');
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

    it('does not send until the page is hidden', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        fireEntries('paint', [{ name: 'first-contentful-paint', startTime: 1200 }]);

        expect(tracker.send).not.toHaveBeenCalled();

        cleanup();
    });

    it('sends all collected metrics together as a single event', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        fireEntries('paint', [{ name: 'first-contentful-paint', startTime: 1200 }]);
        fireEntries('largest-contentful-paint', [{ startTime: 3200 }]);
        fireEntries('layout-shift', [{ hadRecentInput: false, value: 0.05, startTime: 1000 }]);
        fireEntries('event', [{ interactionId: 1, duration: 300, startTime: 100 }]);

        hidePage();

        const event = sentVitals(tracker);
        expect(event.metrics.map(m => m.name).sort()).toEqual(['cls', 'fcp', 'inp', 'lcp', 'ttfb']);

        cleanup();
    });

    it('reports TTFB from navigation entries', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        hidePage();

        const ttfb = metric(sentVitals(tracker), 'ttfb');
        expect(ttfb?.value).toBe(250);
        expect(ttfb?.rating).toBe('good'); // 250 <= 800

        cleanup();
    });

    it('accounts for activationStart in TTFB', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 1000, activationStart: 200 }]);
        hidePage();

        expect(metric(sentVitals(tracker), 'ttfb')?.value).toBe(800); // 1000 - 200

        cleanup();
    });

    it('reports FCP from paint entries', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('paint', [
            { name: 'first-paint', startTime: 500 },
            { name: 'first-contentful-paint', startTime: 1200 },
        ]);
        hidePage();

        const fcp = metric(sentVitals(tracker), 'fcp');
        expect(fcp?.value).toBe(1200);
        expect(fcp?.rating).toBe('good'); // 1200 <= 1800

        cleanup();
    });

    it('reports LCP on page hide using the last observed entry', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('largest-contentful-paint', [
            { startTime: 2000 },
            { startTime: 3200 }, // last entry wins
        ]);

        // LCP isn't reported until page hide
        expect(tracker.send).not.toHaveBeenCalled();

        hidePage();

        const lcp = metric(sentVitals(tracker), 'lcp');
        expect(lcp?.value).toBe(3200);
        expect(lcp?.rating).toBe('needs-improvement'); // 2500 < 3200 <= 4000

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

        hidePage();

        const cls = metric(sentVitals(tracker), 'cls');
        // 0.05 + 0.03 = 0.08
        expect(cls?.value).toBe(0.08);
        expect(cls?.rating).toBe('good'); // 0.08 <= 0.1

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

        hidePage();

        // p98 of [50, 120, 300]: sorted desc = [300, 120, 50], idx = min(2, floor(3/50)) = 0 → 300
        expect(metric(sentVitals(tracker), 'inp')?.value).toBe(300);

        cleanup();
    });

    it('does not collect the same metric twice', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 200, activationStart: 0 }]);
        fireEntries('navigation', [{ responseStart: 300, activationStart: 0 }]);
        hidePage();

        const event = sentVitals(tracker);
        const ttfbMetrics = event.metrics.filter(m => m.name === 'ttfb');
        expect(ttfbMetrics).toHaveLength(1);
        expect(ttfbMetrics[0].value).toBe(200); // first value wins

        cleanup();
    });

    it('does not send twice across visibilitychange and pagehide', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);

        hidePage();
        window.dispatchEvent(new Event('pagehide'));

        expect(tracker.send).toHaveBeenCalledOnce();

        cleanup();
    });

    it('does not send when no metrics were collected', () => {
        // Without layout-shift support there is not even a CLS 0 to report
        supportedEntryTypes = supportedEntryTypes.filter(type => type !== 'layout-shift');
        setupPerformanceObserverMock();
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        hidePage();

        expect(tracker.send).not.toHaveBeenCalled();

        supportedEntryTypes = [...supportedEntryTypes, 'layout-shift'];
        cleanup();
    });

    it('discards paint metrics when the page loaded hidden', () => {
        setVisibilityState('hidden');
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        // A background tab paints when it is first revealed, so the paint
        // startTime spans the whole time the tab sat hidden
        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        fireEntries('paint', [{ name: 'first-contentful-paint', startTime: 67_059_280 }]);
        fireEntries('largest-contentful-paint', [{ startTime: 67_059_280 }]);

        hidePage();

        const event = sentVitals(tracker);
        expect(event.metrics.map(m => m.name)).toEqual(['ttfb', 'cls']);

        cleanup();
    });

    it('discards implausible metric values', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 90_000_000, activationStart: 0 }]);
        fireEntries('paint', [{ name: 'first-contentful-paint', startTime: 1200 }]);
        fireEntries('event', [{ interactionId: 1, duration: 533_805_810, startTime: 100 }]);

        hidePage();

        const event = sentVitals(tracker);
        expect(event.metrics.map(m => m.name)).toEqual(['fcp', 'cls']);

        cleanup();
    });

    it('does not send after a back/forward cache restore', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);

        window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
        hidePage();

        expect(tracker.send).not.toHaveBeenCalled();

        cleanup();
    });

    it('sends CLS 0 when the engine reports layout shifts and none happened', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        hidePage();

        const cls = metric(sentVitals(tracker), 'cls');
        expect(cls?.value).toBe(0);
        expect(cls?.rating).toBe('good');

        cleanup();
    });

    it('leaves CLS out where the engine cannot report layout shifts', () => {
        supportedEntryTypes = supportedEntryTypes.filter(type => type !== 'layout-shift');
        setupPerformanceObserverMock();
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        hidePage();

        expect(metric(sentVitals(tracker), 'cls')).toBeUndefined();

        supportedEntryTypes = [...supportedEntryTypes, 'layout-shift'];
        cleanup();
    });

    it('reports INP from the first input when every interaction was under the event threshold', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('first-input', [
            { entryType: 'first-input', interactionId: 7, duration: 8, startTime: 100 },
        ]);
        hidePage();

        expect(metric(sentVitals(tracker), 'inp')?.value).toBe(8);

        cleanup();
    });

    it('reports INP 0 for a first input that took no measurable time', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('first-input', [
            { entryType: 'first-input', interactionId: 3, duration: 0, startTime: 100 },
        ]);
        hidePage();

        const inp = metric(sentVitals(tracker), 'inp');
        expect(inp?.value).toBe(0);
        expect(inp?.rating).toBe('good');

        cleanup();
    });

    it('files vitals under the URL the document loaded with, not a later SPA route', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        tracker.currentUrl.mockReturnValue('https://example.com/app/settings');
        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        hidePage();

        expect(sentVitals(tracker).url).toBe('https://example.com/page');

        cleanup();
    });

    it('stamps the event with the last activity once the session has expired', () => {
        const lastActivity = Date.now() - 45 * 60 * 1000;
        sessionStorage.setItem('eyes_sid', 'idle-session');
        sessionStorage.setItem('eyes_sid_at', String(lastActivity));
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        hidePage();

        const event = sentVitals(tracker);
        expect(event.timestamp).toBe(lastActivity);
        expect(event.sessionId).toBe('idle-session');

        cleanup();
    });

    it('sends vitals on the ended session when activity after idling starts a new one', () => {
        const lastActivity = Date.now() - 45 * 60 * 1000;
        sessionStorage.setItem('eyes_sid', 'idle-session');
        sessionStorage.setItem('eyes_sid_at', String(lastActivity));
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        touchSession();
        hidePage();

        const event = sentVitals(tracker);
        expect(event.sessionId).toBe('idle-session');
        expect(event.timestamp).toBe(lastActivity);

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

            hidePage();

            expect(metric(sentVitals(tracker), name)?.rating).toBe(expectedRating);

            cleanup();
        });
    });
});

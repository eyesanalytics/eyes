import type { EyesEvent, VitalMetric, VitalsEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '~/config';
import type { EyesTracker } from '~/core';
import { getPageLoadId, leaveVisit, resetSession, touchSession } from '~/session';
import { TEST_SITE_ID } from '~/tests/helpers';
import { initVitals } from '~/vitals';

const noopLogger = { info: vi.fn(), event: vi.fn(), warn: vi.fn() };

const makeTracker = () => ({
    send: vi.fn<(event: EyesEvent) => void>(),
    eventEyesId: vi.fn<() => string | undefined>(),
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

const setPrerendering = (value: boolean) => {
    Object.defineProperty(document, 'prerendering', { value, configurable: true });
};

// A page that prerenders is hidden until its activation, which shows it (or leaves it in a
// background tab)
const startPrerendering = () => {
    setPrerendering(true);
    setVisibilityState('hidden');
};

const activate = (visibility: 'visible' | 'hidden' = 'visible') => {
    setPrerendering(false);
    setVisibilityState(visibility);
    document.dispatchEvent(new Event('prerenderingchange'));
};

// Interactions with ids that go up by 7, as Chromium assigns them
const interactionEntries = (durations: number[]) =>
    durations.map((duration, index) => ({
        interactionId: (index + 1) * 7,
        duration,
        startTime: index * 100,
    }));

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
        resetSession();
        setPrerendering(false);
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

    it('reports INP as the p98 interaction once there are more than 50', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        // 150 interactions of 16 to 165 ms: p98 is the 4th longest (index floor(150 / 50) = 3)
        const durations = Array.from({ length: 150 }, (_, index) => index + 16);
        fireEntries('event', interactionEntries(durations));
        hidePage();

        expect(metric(sentVitals(tracker), 'inp')?.value).toBe(162);

        cleanup();
    });

    it('counts an interaction once across all of its entries', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        // 100 interactions that each report a pointerdown and a click, and a first input that
        // repeats the first one: p98 is the 3rd longest (index floor(100 / 50) = 2)
        const entries = interactionEntries(Array.from({ length: 100 }, (_, index) => index + 16));
        fireEntries('first-input', [{ ...entries[0], entryType: 'first-input' }]);
        fireEntries(
            'event',
            entries.flatMap(entry => [entry, { ...entry, duration: entry.duration - 1 }]),
        );
        hidePage();

        expect(metric(sentVitals(tracker), 'inp')?.value).toBe(113);

        cleanup();
    });

    it('keeps the 10 longest interactions, so past 500 the 10th longest is INP', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        // 600 interactions of 16 to 615 ms over several callbacks, the longest in the first one
        const entries = interactionEntries(Array.from({ length: 600 }, (_, index) => 615 - index));
        for (let start = 0; start < entries.length; start += 100) {
            fireEntries('event', entries.slice(start, start + 100));
        }
        hidePage();

        expect(metric(sentVitals(tracker), 'inp')?.value).toBe(606);

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
        const idleSession = touchSession(lastActivity);
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        hidePage();

        const event = sentVitals(tracker);
        expect(event.timestamp).toBe(lastActivity);
        expect(event.sessionId).toBe(idleSession);

        cleanup();
    });

    it('sends vitals on the ended session when activity after idling starts a new one', () => {
        const lastActivity = Date.now() - 45 * 60 * 1000;
        const idleSession = touchSession(lastActivity);
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        touchSession();
        hidePage();

        const event = sentVitals(tracker);
        expect(event.sessionId).toBe(idleSession);
        expect(event.timestamp).toBe(lastActivity);

        cleanup();
    });

    describe('when the page leaves its visit', () => {
        it('sends the vitals on the visit while it can take them, then stops', () => {
            const session = touchSession();
            const pageLoad = getPageLoadId();
            const tracker = makeTracker();
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
            leaveVisit(true);
            hidePage();

            expect(tracker.send).toHaveBeenCalledOnce();
            const event = sentVitals(tracker);
            expect(event.sessionId).toBe(session);
            expect(event.pageLoadId).toBe(pageLoad);

            cleanup();
        });

        it('drops them when the visit can no longer take them', () => {
            const tracker = makeTracker();
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
            leaveVisit(false);
            hidePage();

            expect(tracker.send).not.toHaveBeenCalled();

            cleanup();
        });

        it('leaves before it builds the event once the eyes_id has gone', () => {
            const tracker = makeTracker();
            tracker.eventEyesId.mockImplementation(() => {
                leaveVisit(false);
                return undefined;
            });
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
            hidePage();

            expect(tracker.send).not.toHaveBeenCalled();

            cleanup();
        });

        it('disconnects every observer once it has left', () => {
            const tracker = makeTracker();
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            leaveVisit(false);

            for (const obs of mockObservers) {
                expect(obs.disconnect).toHaveBeenCalledOnce();
            }

            cleanup();
        });
    });

    it('cleanup disconnects all observers', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        cleanup();

        for (const obs of mockObservers) {
            expect(obs.disconnect).toHaveBeenCalled();
        }
    });

    it('disconnects every observer once the event is sent', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        fireEntries('navigation', [{ responseStart: 250, activationStart: 0 }]);
        fireEntries('event', [{ interactionId: 1, duration: 300, startTime: 100 }]);

        expect(mockObservers.length).toBeGreaterThan(0);
        for (const obs of mockObservers) {
            expect(obs.disconnect).not.toHaveBeenCalled();
        }

        hidePage();

        expect(tracker.send).toHaveBeenCalledOnce();
        for (const obs of mockObservers) {
            expect(obs.disconnect).toHaveBeenCalledOnce();
        }

        cleanup();
    });

    it('keeps observing when there was nothing to send at the first hide', () => {
        supportedEntryTypes = supportedEntryTypes.filter(type => type !== 'layout-shift');
        setupPerformanceObserverMock();
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        hidePage();

        for (const obs of mockObservers) {
            expect(obs.disconnect).not.toHaveBeenCalled();
        }

        supportedEntryTypes = [...supportedEntryTypes, 'layout-shift'];
        cleanup();
    });

    it('disconnects every observer after a back/forward cache restore', () => {
        const tracker = makeTracker();
        const cleanup = initVitals(asTracker(tracker), noopLogger);

        window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));

        for (const obs of mockObservers) {
            expect(obs.disconnect).toHaveBeenCalledOnce();
        }

        cleanup();
    });

    describe('prerendered pages', () => {
        it('collects FCP and LCP, measured from the activation', () => {
            startPrerendering();
            const tracker = makeTracker();
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            fireEntries('navigation', [{ responseStart: 300, activationStart: 2990 }]);
            activate();
            // Chrome paints a prerendered page once it is shown
            fireEntries('paint', [{ name: 'first-contentful-paint', startTime: 3040 }]);
            fireEntries('largest-contentful-paint', [{ startTime: 3200 }]);
            hidePage();

            const event = sentVitals(tracker);
            expect(metric(event, 'fcp')?.value).toBe(50); // 3040 - 2990
            expect(metric(event, 'lcp')?.value).toBe(210); // 3200 - 2990

            cleanup();
        });

        it('reports TTFB 0 when the response came before the activation', () => {
            startPrerendering();
            const tracker = makeTracker();
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            // The entry arrives while the page prerenders and gets its activationStart later
            const navigation = { responseStart: 300, activationStart: 0 };
            fireEntries('navigation', [navigation]);
            activate();
            navigation.activationStart = 2990;
            hidePage();

            const ttfb = metric(sentVitals(tracker), 'ttfb');
            expect(ttfb?.value).toBe(0);
            expect(ttfb?.rating).toBe('good');

            cleanup();
        });

        it('reports FCP and LCP 0 when they painted before the activation', () => {
            startPrerendering();
            const tracker = makeTracker();
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            fireEntries('navigation', [{ responseStart: 300, activationStart: 2990 }]);
            fireEntries('paint', [{ name: 'first-contentful-paint', startTime: 400 }]);
            fireEntries('largest-contentful-paint', [{ startTime: 600 }]);
            activate();
            hidePage();

            const event = sentVitals(tracker);
            expect(metric(event, 'fcp')?.value).toBe(0);
            expect(metric(event, 'lcp')?.value).toBe(0);

            cleanup();
        });

        it('does not send while the page is still prerendering', () => {
            startPrerendering();
            const tracker = makeTracker();
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            fireEntries('navigation', [{ responseStart: 300, activationStart: 0 }]);
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('pagehide'));

            expect(tracker.send).not.toHaveBeenCalled();
            // Nor does it look for the eyes_id, which could make the page leave its visit.
            expect(tracker.eventEyesId).not.toHaveBeenCalled();

            cleanup();
        });

        it('discards paint metrics when the page is activated in the background', () => {
            startPrerendering();
            const tracker = makeTracker();
            const cleanup = initVitals(asTracker(tracker), noopLogger);

            fireEntries('navigation', [{ responseStart: 300, activationStart: 2990 }]);
            activate('hidden');
            // The background tab is revealed much later, and paints then
            setVisibilityState('visible');
            fireEntries('paint', [{ name: 'first-contentful-paint', startTime: 67_059_280 }]);
            fireEntries('largest-contentful-paint', [{ startTime: 67_059_280 }]);
            hidePage();

            expect(sentVitals(tracker).metrics.map(m => m.name)).toEqual(['ttfb', 'cls']);

            cleanup();
        });
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

import type { EyesEvent, VitalMetric } from 'eyes-types';
import type { EyesTracker } from '~/core';
import { getSessionId } from '~/session';
import type { Logger } from '~/utils/logger';

type Rating = 'good' | 'needs-improvement' | 'poor';

interface MetricThresholds {
    good: number;
    poor: number;
}

const THRESHOLDS: Record<string, MetricThresholds> = {
    ttfb: { good: 800, poor: 1800 },
    fcp: { good: 1800, poor: 3000 },
    lcp: { good: 2500, poor: 4000 },
    cls: { good: 0.1, poor: 0.25 },
    inp: { good: 200, poor: 500 },
};

// Values above these caps are broken measurements, not slow pages. A paint or
// interaction whose presentation was deferred while the tab was hidden reports
// a time measured from the original navigation, which can span hours or days.
const MAX_VALUES: Record<string, number> = {
    ttfb: 60_000,
    fcp: 60_000,
    lcp: 60_000,
    cls: 100,
    inp: 60_000,
};

const rate = (name: string, value: number): Rating => {
    const t = THRESHOLDS[name];
    if (!t) return 'good';
    if (value <= t.good) return 'good';
    if (value <= t.poor) return 'needs-improvement';
    return 'poor';
};

/**
 * Observe Core Web Vitals and dispatch them as a single `vitals` event.
 * Metrics are buffered and flushed together when the page is hidden, so one
 * page load produces one event instead of one per metric.
 * Uses PerformanceObserver where available.
 * Returns a cleanup function.
 */
const initVitals = (tracker: EyesTracker, logger: Logger): (() => void) => {
    if (typeof PerformanceObserver === 'undefined') return () => {};

    const observers: PerformanceObserver[] = [];
    const metrics = new Map<string, VitalMetric>();

    // Paint metrics are only valid if the page stayed visible until the paint.
    // A tab that loads in the background paints when it is first revealed, and
    // that paint's startTime is measured from the original navigation.
    let firstHiddenTime = document.visibilityState === 'hidden' ? 0 : Number.POSITIVE_INFINITY;

    const collect = (name: string, value: number): void => {
        if (metrics.has(name)) return;
        if (!Number.isFinite(value) || value < 0 || value > MAX_VALUES[name]) return;

        const rounded = name === 'cls' ? Math.round(value * 1000) / 1000 : Math.round(value);
        const rating = rate(name, name === 'cls' ? value : rounded);

        metrics.set(name, { name, value: rounded, rating });
    };

    const observe = (
        type: string,
        callback: (entries: PerformanceEntryList) => void,
        options?: PerformanceObserverInit,
    ): void => {
        try {
            const observer = new PerformanceObserver(list => callback(list.getEntries()));
            observer.observe({ type, buffered: true, ...options });
            observers.push(observer);
        } catch {
            // Observer type not supported, skip
        }
    };

    // -----------------------------------------------------------------
    // TTFB: Time to First Byte
    // -----------------------------------------------------------------
    observe('navigation', entries => {
        const navigation = entries[0] as
            | (PerformanceNavigationTiming & { activationStart?: number })
            | undefined;
        if (navigation?.responseStart) {
            const activationStart = navigation.activationStart ?? 0;
            collect('ttfb', navigation.responseStart - activationStart);
        }
    });

    // -----------------------------------------------------------------
    // FCP: First Contentful Paint
    // -----------------------------------------------------------------
    observe('paint', entries => {
        const fcp = entries.find(entry => entry.name === 'first-contentful-paint');
        if (fcp && fcp.startTime < firstHiddenTime) collect('fcp', fcp.startTime);
    });

    // -----------------------------------------------------------------
    // LCP: Largest Contentful Paint
    // -----------------------------------------------------------------
    // The browser stops emitting LCP candidates after the first interaction,
    // so the last observed value is final by the time the page is hidden.
    let lcpValue = 0;
    observe('largest-contentful-paint', entries => {
        const last = entries.at(-1);
        if (last && last.startTime < firstHiddenTime) lcpValue = last.startTime;
    });

    // -----------------------------------------------------------------
    // CLS: Cumulative Layout Shift
    // -----------------------------------------------------------------
    let clsValue = 0;
    let clsSessionValue = 0;
    let clsSessionEntries: PerformanceEntry[] = [];

    observe('layout-shift', entries => {
        for (const entry of entries as (PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
        })[]) {
            if (entry.hadRecentInput) continue;

            // Windowed CLS (session window with 1s gap, 5s max)
            const last = clsSessionEntries.at(-1);
            const isWithinSession =
                last &&
                entry.startTime - last.startTime < 1000 &&
                entry.startTime - clsSessionEntries[0].startTime < 5000;

            if (!isWithinSession) {
                clsSessionValue = entry.value;
                clsSessionEntries = [entry];
            }

            if (isWithinSession) {
                clsSessionValue += entry.value;
                clsSessionEntries.push(entry);
            }

            if (clsSessionValue > clsValue) {
                clsValue = clsSessionValue;
            }
        }
    });

    // -----------------------------------------------------------------
    // INP: Interaction to Next Paint
    // -----------------------------------------------------------------
    let inpValue = 0;
    const interactions = new Map<number, number>();

    observe(
        'event',
        entries => {
            for (const entry of entries as (PerformanceEntry & {
                interactionId: number;
                duration: number;
            })[]) {
                if (!entry.interactionId) continue;

                const existing = interactions.get(entry.interactionId) ?? 0;
                const duration = entry.duration;

                if (duration > existing) {
                    interactions.set(entry.interactionId, duration);
                }
            }

            // INP = p98 of interaction durations
            if (interactions.size > 0) {
                const sorted = [...interactions.values()].sort((a, b) => b - a);
                const idx = Math.min(sorted.length - 1, Math.floor(sorted.length / 50));
                inpValue = sorted[idx];
            }
        },
        { durationThreshold: 16 } as PerformanceObserverInit,
    );

    // -----------------------------------------------------------------
    // Flush on page hide: LCP, CLS and INP finalise here and every
    // collected metric is dispatched together as a single `vitals` event.
    // -----------------------------------------------------------------
    let sent = false;

    const flush = (): void => {
        if (sent) return;

        if (lcpValue > 0) collect('lcp', lcpValue);
        if (clsValue > 0) collect('cls', clsValue);
        if (inpValue > 0) collect('inp', inpValue);

        if (metrics.size === 0) return;
        sent = true;

        const collected = [...metrics.values()];
        logger.event('vitals', { metrics: collected });

        const event: EyesEvent = {
            type: 'vitals',
            url: tracker.currentUrl(),
            sessionId: getSessionId(),
            timestamp: Date.now(),
            metrics: collected,
        };

        tracker.send(event);
    };

    const onVisibilityChange = (): void => {
        if (document.visibilityState !== 'hidden') return;

        firstHiddenTime = Math.min(firstHiddenTime, performance.now());
        flush();
    };

    // After a back/forward cache restore every timestamp is still relative to
    // the original navigation, so nothing measured afterwards is trustworthy.
    const onPageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) sent = true;
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    window.addEventListener('pageshow', onPageShow);

    return () => {
        for (const obs of observers) obs.disconnect();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', flush);
        window.removeEventListener('pageshow', onPageShow);
    };
};

export { initVitals };

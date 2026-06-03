import type { EyesEvent } from 'eyes-types';
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

const rate = (name: string, value: number): Rating => {
    const t = THRESHOLDS[name];
    if (!t) return 'good';
    if (value <= t.good) return 'good';
    if (value <= t.poor) return 'needs-improvement';
    return 'poor';
};

/**
 * Observe Core Web Vitals and dispatch them as `vitals` events.
 * Uses PerformanceObserver where available.
 * Returns a cleanup function.
 */
const initVitals = (tracker: EyesTracker, logger: Logger): (() => void) => {
    if (typeof PerformanceObserver === 'undefined') return () => {};

    const observers: PerformanceObserver[] = [];
    const reported = new Set<string>();

    const report = (name: string, value: number): void => {
        if (reported.has(name)) return;
        reported.add(name);

        const rounded = name === 'cls' ? Math.round(value * 1000) / 1000 : Math.round(value);
        const rating = rate(name, name === 'cls' ? value : rounded);

        logger.event('vitals', { name, value: rounded, rating });

        const event: EyesEvent = {
            type: 'vitals',
            url: tracker.currentUrl(),
            sessionId: getSessionId(),
            timestamp: Date.now(),
            metric: { name, value: rounded, rating },
        };

        tracker.send(event);
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
    // TTFB — Time to First Byte
    // -----------------------------------------------------------------
    observe('navigation', entries => {
        const navigation = entries[0] as
            | (PerformanceNavigationTiming & { activationStart?: number })
            | undefined;
        if (navigation?.responseStart) {
            const activationStart = navigation.activationStart ?? 0;
            report('ttfb', navigation.responseStart - activationStart);
        }
    });

    // -----------------------------------------------------------------
    // FCP — First Contentful Paint
    // -----------------------------------------------------------------
    observe('paint', entries => {
        const fcp = entries.find(entry => entry.name === 'first-contentful-paint');
        if (fcp) report('fcp', fcp.startTime);
    });

    // -----------------------------------------------------------------
    // LCP — Largest Contentful Paint
    // -----------------------------------------------------------------
    let lcpValue = 0;
    observe('largest-contentful-paint', entries => {
        const last = entries.at(-1);
        if (last) lcpValue = last.startTime;
    });

    // LCP finalises on first input or page hide
    const finaliseLcp = (): void => {
        if (lcpValue > 0) report('lcp', lcpValue);
    };

    // -----------------------------------------------------------------
    // CLS — Cumulative Layout Shift
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
    // INP — Interaction to Next Paint
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
    // Finalise on page hide — LCP, CLS, INP are reported at this point
    // -----------------------------------------------------------------

    const onPageHide = (): void => {
        finaliseLcp();
        if (clsValue > 0) report('cls', clsValue);
        if (inpValue > 0) report('inp', inpValue);
    };

    const onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') onPageHide();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    window.addEventListener('pagehide', onPageHide);

    // Finalise LCP on first interaction
    const onFirstInteraction = () => {
        finaliseLcp();
        window.removeEventListener('keydown', onFirstInteraction, true);
        window.removeEventListener('click', onFirstInteraction, true);
    };
    window.addEventListener('keydown', onFirstInteraction, { capture: true, once: true });
    window.addEventListener('click', onFirstInteraction, { capture: true, once: true });

    return () => {
        for (const obs of observers) obs.disconnect();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('keydown', onFirstInteraction, true);
        window.removeEventListener('click', onFirstInteraction, true);
    };
};

export { initVitals };

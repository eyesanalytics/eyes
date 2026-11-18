import type { EyesEvent, VitalMetric } from 'eyes-types';
import type { EyesTracker } from '~/core';
import {
    getPageLoadId,
    getSessionId,
    onSessionExpire,
    onVisitLeave,
    sessionTimestamp,
} from '~/session';
import type { Logger } from '~/utils/logger';

type Rating = 'good' | 'needs-improvement' | 'poor';

interface PrerenderingDocument extends Document {
    prerendering?: boolean;
}

interface ActivatedNavigationTiming extends PerformanceNavigationTiming {
    activationStart?: number;
}

interface Interaction {
    id: number;
    duration: number;
}

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

// INP is the 98th percentile of a page's interactions: the longest one, then the next longest for
// every 50 interactions. Below 500 interactions that is always one of the 10 longest, so only those
// are kept, like the web-vitals library does, and past that the 10th longest stands in.
const MAX_INTERACTIONS = 10;

const rate = (name: string, value: number): Rating => {
    const t = THRESHOLDS[name];
    if (!t) return 'good';
    if (value <= t.good) return 'good';
    if (value <= t.poor) return 'needs-improvement';
    return 'poor';
};

/**
 * Observe Core Web Vitals and dispatch them as a single `vitals` event.
 * Metrics are buffered and flushed together when the page is first hidden, so one
 * page load produces one event instead of one per metric. That makes INP and CLS
 * final at the first hide: once the event is sent every observer is disconnected,
 * and interactions or layout shifts after it are not measured.
 * A prerendered page is measured from its activation, when the visitor sees it.
 * Uses PerformanceObserver where available.
 * Returns a cleanup function.
 */
const initVitals = (tracker: EyesTracker, logger: Logger): (() => void) => {
    if (typeof PerformanceObserver === 'undefined') return () => {};

    const observers: PerformanceObserver[] = [];
    const metrics = new Map<string, VitalMetric>();
    const prerenderingDocument = document as PrerenderingDocument;

    // TTFB, FCP and LCP belong to this document load, so the event is filed under the URL the
    // document loaded with, not whichever SPA route is active when the page is hidden.
    const documentUrl = tracker.currentUrl();

    // A page without shifts has a CLS of 0, which is a real (good) sample. Only engines that
    // report layout shifts at all (Chromium) can say so.
    const supportsLayoutShift =
        PerformanceObserver.supportedEntryTypes?.includes('layout-shift') ?? false;

    // A prerendering page reports itself hidden, but the visitor only sees it from its activation,
    // so until then it does not count as hidden.
    const isHidden = (): boolean =>
        document.visibilityState === 'hidden' && !prerenderingDocument.prerendering;

    // Paint metrics are only valid if the page stayed visible until the paint.
    // A tab that loads in the background paints when it is first revealed, and
    // that paint's startTime is measured from the original navigation.
    let firstHiddenTime = isHidden() ? 0 : Number.POSITIVE_INFINITY;

    // A prerendered page that is activated in the background has been hidden all along.
    const onActivation = (): void => {
        if (isHidden()) firstHiddenTime = 0;
    };

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
    // A prerendering page gets this entry before its activation, while its activationStart is
    // still 0. The entry fills it in at activation, so TTFB is worked out at the flush.
    let navigation: ActivatedNavigationTiming | undefined;
    observe('navigation', entries => {
        navigation ??= entries[0] as ActivatedNavigationTiming | undefined;
    });

    // -----------------------------------------------------------------
    // FCP: First Contentful Paint
    // -----------------------------------------------------------------
    let fcpValue: number | undefined;
    observe('paint', entries => {
        const fcp = entries.find(entry => entry.name === 'first-contentful-paint');
        if (fcp && fcp.startTime < firstHiddenTime) fcpValue ??= fcp.startTime;
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
    // The longest interactions, longest first, and how many the page has had.
    const interactions: Interaction[] = [];
    let interactionCount = 0;
    let lastInteractionId = 0;

    const recordInteractions = (
        entries: (PerformanceEntry & { interactionId?: number; duration: number })[],
    ): void => {
        for (const entry of entries) {
            // A first-input entry without an interaction id still is the page's first interaction.
            const id = entry.interactionId || (entry.entryType === 'first-input' ? -1 : 0);
            if (!id) continue;

            // Interaction ids only go up, so an id above every earlier one is a new interaction.
            // A page has one first input, so its stand-in id is new as well.
            if (id < 0 || id > lastInteractionId) interactionCount++;
            lastInteractionId = Math.max(lastInteractionId, id);

            const existing = interactions.find(interaction => interaction.id === id);
            if (existing) existing.duration = Math.max(existing.duration, entry.duration);
            if (!existing) interactions.push({ id, duration: entry.duration });

            interactions.sort((a, b) => b.duration - a.duration);
            interactions.splice(MAX_INTERACTIONS);
        }
    };

    observe(
        'event',
        entries => recordInteractions(entries as Parameters<typeof recordInteractions>[0]),
        { durationThreshold: 16 } as PerformanceObserverInit,
    );

    // Interactions faster than the 16 ms threshold never reach the event observer. The first
    // input is always reported, so a page whose interactions were all fast still gets an INP
    // sample instead of none, which would skew p75 upward.
    observe('first-input', entries =>
        recordInteractions(entries as Parameters<typeof recordInteractions>[0]),
    );

    // -----------------------------------------------------------------
    // Flush on page hide: LCP, CLS and INP finalise here and every
    // collected metric is dispatched together as a single `vitals` event.
    // -----------------------------------------------------------------
    let sent = false;

    // Once the event is sent nothing more is measured, so the observers and the interactions they
    // gathered can go.
    const stop = (): void => {
        sent = true;
        for (const observer of observers) observer.disconnect();
        interactions.length = 0;
    };

    const flush = (): void => {
        if (prerenderingDocument.prerendering) return;

        // Read first: once the eyes_id has gone, the page leaves its visit, which ends its vitals
        const eyesId = tracker.eventEyesId();
        if (sent) return;

        // A prerendered page is shown at its activation, so its response and paints count from
        // there. One that came before the activation counts as 0: the visitor never waited for it.
        const activationStart = navigation?.activationStart ?? 0;
        const sinceActivation = (time: number): number => Math.max(0, time - activationStart);

        if (navigation?.responseStart) collect('ttfb', sinceActivation(navigation.responseStart));
        if (fcpValue !== undefined) collect('fcp', sinceActivation(fcpValue));
        if (lcpValue > 0) collect('lcp', sinceActivation(lcpValue));
        if (supportsLayoutShift) collect('cls', clsValue);

        const inp =
            interactions[Math.min(interactions.length - 1, Math.floor(interactionCount / 50))];
        if (inp) collect('inp', inp.duration);

        if (metrics.size === 0) return;
        stop();

        const collected = [...metrics.values()];
        logger.event('vitals', { metrics: collected });

        const event: EyesEvent = {
            type: 'vitals',
            url: documentUrl,
            eyesId,
            sessionId: getSessionId(),
            pageLoadId: getPageLoadId(),
            timestamp: sessionTimestamp(),
            metrics: collected,
        };

        tracker.send(event);
    };

    const onVisibilityChange = (): void => {
        if (!isHidden()) return;

        firstHiddenTime = Math.min(firstHiddenTime, performance.now());
        flush();
    };

    // After a back/forward cache restore every timestamp is still relative to
    // the original navigation, so nothing measured afterwards is trustworthy.
    const onPageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) stop();
    };

    // The document's vitals belong to the visit it loaded in. When activity ends that visit, send
    // them on its session and stop, so a later hide does not file them on the next session.
    const offSessionExpire = onSessionExpire(() => {
        flush();
        stop();
    });

    // The same holds when the page leaves its visit: send them on it while it can take them, then
    // stop, since a vitals row alone would count as a visit on the session that follows.
    const offVisitLeave = onVisitLeave(report => {
        if (report) flush();
        stop();
    });

    document.addEventListener('prerenderingchange', onActivation);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    window.addEventListener('pageshow', onPageShow);

    return () => {
        for (const obs of observers) obs.disconnect();
        offSessionExpire();
        offVisitLeave();
        document.removeEventListener('prerenderingchange', onActivation);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', flush);
        window.removeEventListener('pageshow', onPageShow);
    };
};

export { initVitals };

import type { EyesEvent, ResolvedConfig } from 'eyes-types';
import { isBot } from '~/utils/is-bot';
import type { Logger } from '~/utils/logger';

interface Transport {
    enqueue(event: EyesEvent): void;
    /** Drop every event that has not gone out yet, including batches waiting for a retry. */
    clear(): void;
    flush(): Promise<void>;
    start(): void;
    stop(): void;
}

// A 429 or 503 is a definite rejection: the server stored nothing, so the batch can safely go once
// more. Every other outcome, including a network error, is final.
const RETRY_STATUSES = new Set([429, 503]);
const DEFAULT_RETRY_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 60_000;

/** Delay before retrying a rejected batch, from a Retry-After header in seconds or as a date. */
const retryDelay = (retryAfter: string | null): number => {
    if (!retryAfter) return DEFAULT_RETRY_DELAY_MS;

    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isNaN(delay)) return DEFAULT_RETRY_DELAY_MS;

    return Math.min(Math.max(delay, 0), MAX_RETRY_DELAY_MS);
};

const createTransport = (config: ResolvedConfig, logger: Logger): Transport => {
    const queue: EyesEvent[] = [];
    const retries = new Set<ReturnType<typeof setTimeout>>();
    let timer: ReturnType<typeof setInterval> | null = null;
    let bot: boolean | null = null;

    // The site id rides in the query string and the body goes as text/plain, so a fetch stays a
    // simple CORS request without a preflight, and a beacon (which cannot set headers) uses the
    // same URL.
    const url = `${config.endpoint}/v1/events?site_id=${encodeURIComponent(config.siteId)}`;

    // Lazy bot detection (navigator may not be ready at import time)
    const checkBot = (): boolean => {
        if (bot === null) bot = isBot();
        return bot;
    };

    // Flush listeners (page hide / visibility change). The page may be unloading or about to be
    // frozen, so these flushes go out as beacons.
    const onPageHide = () => {
        flushQueue(true);
    };

    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') flushQueue(true);
    };

    // Retry a rejected batch once. A timer only fires while the page is alive, so a batch that is
    // still waiting when the page goes away is lost rather than resent.
    const scheduleRetry = (events: EyesEvent[], retryAfter: string | null): void => {
        const delay = retryDelay(retryAfter);
        logger.info(`Retrying ${events.length} event(s) in ${delay}ms`);

        const retry = setTimeout(() => {
            retries.delete(retry);
            post(events, true);
        }, delay);
        retries.add(retry);
    };

    // POST a batch with fetch. A beacon cannot read the response, so only this path retries.
    const post = async (events: EyesEvent[], retried: boolean): Promise<void> => {
        if (typeof fetch !== 'function') return;

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(events),
                keepalive: true,
            });
        } catch {
            // Never resend: a keepalive request can reach the server even when its promise
            // rejects because the page went away, and a second copy would double count.
            logger.info(`Flush of ${events.length} event(s) failed`);
            return;
        }

        if (retried || !RETRY_STATUSES.has(response.status)) return;

        scheduleRetry(events, response.headers.get('Retry-After'));
    };

    // Send a batch of events to the server
    const send = async (events: EyesEvent[], unloading: boolean): Promise<void> => {
        if (events.length === 0 || checkBot()) return;

        logger.info(`Flushing ${events.length} event(s)`);

        // A beacon survives the page going away. With a string body it is sent as text/plain.
        if (unloading && typeof navigator.sendBeacon === 'function') {
            if (navigator.sendBeacon(url, JSON.stringify(events))) return;
        }

        await post(events, false);
    };

    // Enqueue an event, flush if batch size exceeded
    const enqueue = (event: EyesEvent): void => {
        if (checkBot()) return;
        queue.push(event);
        logger.event(event.type, {
            name: 'name' in event ? event.name : event.type,
            url: event.url,
            ...('props' in event && event.props ? { props: event.props } : {}),
            ...('metrics' in event && event.metrics ? { metrics: event.metrics } : {}),
        });
        if (queue.length >= config.maxBatchSize) {
            flush();
        }
    };

    const clear = (): void => {
        queue.length = 0;
        for (const retry of retries) clearTimeout(retry);
        retries.clear();
    };

    // Flush the queue
    const flushQueue = (unloading: boolean): Promise<void> => {
        if (queue.length === 0) return Promise.resolve();
        const batch = queue.splice(0);
        return send(batch, unloading);
    };

    const flush = (): Promise<void> => flushQueue(false);

    // Start the transport (set up timers and listeners)
    const start = (): void => {
        if (checkBot()) {
            logger.info('Bot detected, tracking disabled');
            return;
        }

        timer = setInterval(flush, config.flushInterval);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', onPageHide);
    };

    // Stop the transport (clear timers and listeners)
    const stop = (): void => {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        for (const retry of retries) clearTimeout(retry);
        retries.clear();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', onPageHide);
    };

    return { enqueue, clear, flush, start, stop };
};

export type { Transport };
export { createTransport };

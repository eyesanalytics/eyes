import type { EyesEvent, ResolvedConfig, SentEvent } from 'eyes-types';
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

// Browsers allow 64 KiB of keepalive bodies in flight per page, shared with beacons and the page's
// other scripts, and fail a request past that as a network error. A body that does not fit with
// room to spare goes without keepalive.
const KEEPALIVE_BUDGET_BYTES = 48 * 1024;

/** Delay before retrying a rejected batch, from a Retry-After header in seconds or as a date. */
const retryDelay = (retryAfter: string | null): number => {
    if (!retryAfter) return DEFAULT_RETRY_DELAY_MS;

    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isNaN(delay)) return DEFAULT_RETRY_DELAY_MS;

    return Math.min(Math.max(delay, 0), MAX_RETRY_DELAY_MS);
};

/**
 * Serialise a batch, stamping every event with the browser clock at the moment it goes out. The
 * server compares `sentAt` with its own receive time to correct the timestamps for a browser clock
 * that runs wrong, and keeps how long each event waited in the queue (or was backdated).
 */
const serialize = (events: EyesEvent[]): string => {
    const sentAt = Date.now();
    const sent: SentEvent[] = events.map(event => ({ ...event, sentAt }));

    return JSON.stringify(sent);
};

const createTransport = (config: ResolvedConfig, logger: Logger): Transport => {
    const queue: EyesEvent[] = [];
    // Batches waiting for their one retry, by the timer that sends them
    const retries = new Map<ReturnType<typeof setTimeout>, EyesEvent[]>();
    // One-shot, armed by the first event queued: no timer runs while the queue is empty
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    // Body bytes of the keepalive requests this transport has in flight
    let keepaliveBytes = 0;
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

    // Flush listeners (page hide / visibility change). The page may be unloading, or hidden and
    // about to be frozen or discarded, so what has not gone out leaves now as beacons: the queue,
    // and the batches waiting for their retry, which take that one retry now. A page that comes
    // back sends none of it again.
    const onPageHide = () => {
        flushQueue(true);
        for (const [retry, events] of retries) {
            clearTimeout(retry);
            send(events, true, true);
        }
        retries.clear();
    };

    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') onPageHide();
    };

    // Retry a rejected batch once. A timer only fires while the page is alive, so a batch that is
    // still waiting when the page is hidden or goes away is sent at once instead (see onPageHide).
    const scheduleRetry = (events: EyesEvent[], retryAfter: string | null): void => {
        const delay = retryDelay(retryAfter);
        logger.info(`Retrying ${events.length} event(s) in ${delay}ms`);

        const retry = setTimeout(() => {
            retries.delete(retry);
            post(events, true);
        }, delay);
        retries.set(retry, events);
    };

    // POST a batch with fetch. A beacon cannot read the response, so only this path retries.
    const post = async (events: EyesEvent[], retried: boolean): Promise<void> => {
        if (typeof fetch !== 'function') return;

        const body = serialize(events);
        // keepalive lets the request outlive the page, within the quota the browser counts in bytes
        const size = new Blob([body]).size;
        const keepalive = keepaliveBytes + size <= KEEPALIVE_BUDGET_BYTES;
        if (keepalive) keepaliveBytes += size;

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body,
                keepalive,
            });
        } catch {
            // Never resend: a keepalive request can reach the server even when its promise
            // rejects because the page went away, and a second copy would double count.
            logger.info(`Flush of ${events.length} event(s) failed`);
            return;
        } finally {
            if (keepalive) keepaliveBytes -= size;
        }

        if (response.ok) return;

        // The reason is only read in debug mode, the one place it is logged
        if (config.debug) {
            const reason = await response.text().catch(() => '');
            logger.warn(
                `Server refused ${events.length} event(s) with status ${response.status}`,
                reason,
            );
        }

        if (retried || !RETRY_STATUSES.has(response.status)) return;

        scheduleRetry(events, response.headers.get('Retry-After'));
    };

    // Send a batch of events to the server
    const send = async (
        events: EyesEvent[],
        unloading: boolean,
        retried = false,
    ): Promise<void> => {
        if (events.length === 0 || checkBot()) return;

        logger.info(`Flushing ${events.length} event(s)`);

        // A beacon survives the page going away. With a string body it is sent as text/plain.
        if (unloading && typeof navigator.sendBeacon === 'function') {
            if (navigator.sendBeacon(url, serialize(events))) return;
        }

        await post(events, retried);
    };

    // Arm the flush timer, while the transport runs and the queue holds events
    const arm = (): void => {
        if (started && !timer && queue.length > 0) timer = setTimeout(flush, config.flushInterval);
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
            return;
        }

        arm();
    };

    // Cancel the flush timer and the retries that wait for theirs
    const cancelTimers = (): void => {
        clearTimeout(timer);
        timer = undefined;
        for (const retry of retries.keys()) clearTimeout(retry);
        retries.clear();
    };

    const clear = (): void => {
        queue.length = 0;
        cancelTimers();
    };

    // Flush the queue. Its timer goes with it; the next event queued arms a new one.
    const flushQueue = (unloading: boolean): Promise<void> => {
        clearTimeout(timer);
        timer = undefined;
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

        started = true;
        arm();
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', onPageHide);
    };

    // Stop the transport (clear timers and listeners). A flush by hand still sends the queue.
    const stop = (): void => {
        started = false;
        cancelTimers();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', onPageHide);
    };

    return { enqueue, clear, flush, start, stop };
};

export type { Transport };
export { createTransport };

import type { EyesEvent, ResolvedConfig } from 'eyes-types';
import { isBot } from '~/utils/is-bot';
import type { Logger } from '~/utils/logger';

interface Transport {
    enqueue(event: EyesEvent): void;
    flush(): Promise<void>;
    start(): void;
    stop(): void;
}

const createTransport = (config: ResolvedConfig, logger: Logger): Transport => {
    const queue: EyesEvent[] = [];
    let timer: ReturnType<typeof setInterval> | null = null;
    let bot: boolean | null = null;

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

    // Send a batch of events to the server
    const send = async (events: EyesEvent[], unloading: boolean): Promise<void> => {
        if (events.length === 0 || checkBot()) return;

        const url = `${config.endpoint}/v1/events`;
        const body = JSON.stringify(events);

        logger.info(`Flushing ${events.length} event(s)`);

        // A beacon survives the page going away. It cannot set headers, so the site id rides in
        // the query string, which ingress accepts as well.
        if (unloading && typeof navigator.sendBeacon === 'function') {
            const beaconUrl = `${url}?site_id=${encodeURIComponent(config.siteId)}`;
            if (navigator.sendBeacon(beaconUrl, body)) return;
        }

        if (typeof fetch !== 'function') return;

        try {
            await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Eyes-Site-Id': config.siteId,
                },
                body,
                keepalive: true,
            });
        } catch {
            // Never resend: a keepalive request can reach the server even when its promise
            // rejects because the page went away, and a second copy would double count.
            logger.info(`Flush of ${events.length} event(s) failed`);
        }
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
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', onPageHide);
    };

    return { enqueue, flush, start, stop };
};

export type { Transport };
export { createTransport };

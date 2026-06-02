import type { EyesEvent, ResolvedConfig } from '@eyes/types';
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

    // Flush listeners (page hide / visibility change)
    const onPageHide = () => {
        flush();
    };

    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') flush();
    };

    // Send a batch of events to the server
    const send = async (events: EyesEvent[]): Promise<void> => {
        if (events.length === 0 || checkBot()) return;

        const url = `${config.endpoint}/v1/events`;
        const body = JSON.stringify(events);

        logger.info(`Flushing ${events.length} event(s)`);

        // Prefer fetch + keepalive; fall back to sendBeacon
        if (typeof fetch === 'function') {
            try {
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true,
                });
                return;
            } catch {
                // fetch may fail with keepalive on page unload, try beacon
            }
        }

        if (typeof navigator.sendBeacon === 'function') {
            navigator.sendBeacon(url, body);
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
            ...('metric' in event && event.metric ? { metric: event.metric } : {}),
        });
        if (queue.length >= config.maxBatchSize) {
            flush();
        }
    };

    // Flush the queue
    const flush = (): Promise<void> => {
        if (queue.length === 0) return Promise.resolve();
        const batch = queue.splice(0);
        return send(batch);
    };

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

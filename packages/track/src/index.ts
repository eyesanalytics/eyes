import type { EyesConfig, EyesContract, IdentifyTraits, Props } from 'eyes-types';
import { EyesTracker } from '~/core';
import { isBrowser } from '~/utils/is-browser';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let instance: EyesTracker | null = null;

// track/page calls made before init(), replayed once the tracker exists. Capped,
// so a page that never calls init() does not grow it forever.
const MAX_PENDING = 100;
let pending: ((tracker: EyesTracker) => void)[] = [];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
const enqueue = (call: (tracker: EyesTracker) => void): void => {
    if (!isBrowser() || pending.length >= MAX_PENDING) return;

    pending.push(call);
};

const wrap = (t: EyesTracker): EyesContract => ({
    track: (name, props) => t.track(name, props),
    page: props => t.page(props),
    consent: () => t.consent(),
    revokeConsent: () => t.revokeConsent(),
    identify: traits => t.identify(traits),
    flush: () => t.flush(),
    shutdown: () => t.shutdown(),
});

const noop = () => {};
const asyncNoop = () => Promise.resolve();

const NOOP_API: EyesContract = {
    track: noop,
    page: noop,
    consent: noop,
    revokeConsent: noop,
    identify: noop,
    flush: asyncNoop,
    shutdown: asyncNoop,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise Eyes Analytics. Call once at app startup.
 * Returns the tracker instance, subsequent calls return the same instance.
 *
 * @example
 * ```ts
 * import { init } from '@eyes/track';
 *
 * const eyes = init({ siteId: '123456789' });
 *
 * eyes.track('Signup Completed', { plan: 'pro' });
 * ```
 */
const init = (config: EyesConfig): EyesContract => {
    if (!isBrowser()) return NOOP_API;

    if (instance) {
        if (config.debug) {
            console.warn('[Eyes] Already initialised, returning existing instance');
        }
        return wrap(instance);
    }

    const tracker = new EyesTracker(config);
    instance = tracker;

    // Replay after the constructor's initial pageview, so queued events land on that page.
    const queued = pending;
    pending = [];
    for (const call of queued) call(tracker);

    return wrap(tracker);
};

/** Track a named event. Calls made before init() are queued and sent once it runs. */
const track = (name: string, props?: Props): void => {
    if (instance) {
        instance.track(name, props);
        return;
    }

    enqueue(tracker => tracker.track(name, props));
};

/** Record a pageview. Calls made before init() are queued and sent once it runs. */
const page = (props?: Props): void => {
    if (instance) {
        instance.page(props);
        return;
    }

    enqueue(tracker => tracker.page(props));
};

/** Grant consent: sets persistent eyes_id cookie. */
const consent = (): void => {
    instance?.consent();
};

/** Revoke consent: removes eyes_id cookie, reverts to anonymous. */
const revokeConsent = (): void => {
    instance?.revokeConsent();
};

/** Identify the current visitor with user traits. Requires consent. */
const identify = (traits: IdentifyTraits): void => {
    instance?.identify(traits);
};

/** Flush all queued events to the server. */
const flush = async (): Promise<void> => {
    await instance?.flush();
};

/** Stop all tracking, flush remaining events, tear down everything. */
const shutdown = async (): Promise<void> => {
    await instance?.shutdown();
    instance = null;
};

export type {
    BeforeSendHook,
    EventType,
    EyesConfig,
    EyesContract,
    EyesEvent,
    IdentifyTraits,
    Props,
    PropValue,
} from 'eyes-types';
export { consent, flush, identify, init, page, revokeConsent, shutdown, track };

import type { EyesConfig, ResolvedConfig } from 'eyes-types';
import { createLogger } from '~/utils/logger';

const DEFAULT_ENDPOINT = 'https://ingress.eyes.dev';

const DEFAULTS: Omit<ResolvedConfig, 'siteId'> = {
    endpoint: DEFAULT_ENDPOINT,
    debug: false,
    consentRequired: true,
    autoPageview: true,
    autoOutbound: true,
    hashRouting: false,
    flushInterval: 5000,
    maxBatchSize: 10,
    beforeSend: e => e,
};

/**
 * Merge user-provided config with sensible defaults.
 */
const resolveConfig = (input: EyesConfig): ResolvedConfig => {
    if (!input.siteId) {
        throw new Error('[Eyes] `siteId` is required');
    }

    if (!/^\d{9}$/.test(input.siteId)) {
        throw new Error('[Eyes] `siteId` must be a 9-digit numeric string');
    }

    // A wrapper that forwards its own optional props passes them as undefined, which must not
    // override a default.
    const config: ResolvedConfig = {
        ...DEFAULTS,
        ...Object.fromEntries(Object.entries(input).filter(([, value]) => value != null)),
        siteId: input.siteId,
        endpoint: (input.endpoint?.trim() || DEFAULTS.endpoint).replace(/\/+$/, ''),
    };
    const logger = createLogger(config.debug);
    const { beforeSend } = config;

    // A number within its bounds. Anything that is not a finite number takes the default.
    const bounded = (key: 'flushInterval' | 'maxBatchSize', min: number, max: number): number => {
        const value = config[key];
        const result = Number.isFinite(value) ? Math.min(Math.max(value, min), max) : DEFAULTS[key];
        if (result !== value) logger.warn(`Using ${result} for \`${key}\` instead of`, value);

        return result;
    };

    // The ingress rejects a request with more than 50 events
    config.maxBatchSize = bounded('maxBatchSize', 1, 50);
    config.flushInterval = bounded('flushInterval', 1000, Number.POSITIVE_INFINITY);

    // Every event goes through here, so a throwing hook never reaches the host app's own call
    config.beforeSend = event => {
        try {
            return beforeSend(event);
        } catch (error) {
            logger.warn('`beforeSend` threw, the event is dropped', error);
            return null;
        }
    };

    return config;
};

export { DEFAULT_ENDPOINT, resolveConfig };

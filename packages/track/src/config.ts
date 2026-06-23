import type { EyesConfig, ResolvedConfig } from 'eyes-types';

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

    const endpoint = (input.endpoint?.trim() || DEFAULTS.endpoint).replace(/\/+$/, '');

    return {
        ...DEFAULTS,
        ...input,
        endpoint,
        consentRequired: input.consentRequired ?? DEFAULTS.consentRequired,
        beforeSend: input.beforeSend ?? DEFAULTS.beforeSend,
    };
};

export { DEFAULT_ENDPOINT, resolveConfig };

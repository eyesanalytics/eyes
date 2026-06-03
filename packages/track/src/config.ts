import type { EyesConfig, ResolvedConfig } from 'eyes-types';

const DEFAULTS: Omit<ResolvedConfig, 'endpoint'> = {
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
 * Throws if `endpoint` is missing.
 */
const resolveConfig = (input: EyesConfig): ResolvedConfig => {
    if (!input.endpoint) {
        throw new Error('[Eyes] `endpoint` is required');
    }

    // Strip trailing slash from endpoint
    const endpoint = input.endpoint.replace(/\/+$/, '');

    return {
        ...DEFAULTS,
        ...input,
        endpoint,
        consentRequired: input.consentRequired ?? DEFAULTS.consentRequired,
        beforeSend: input.beforeSend ?? DEFAULTS.beforeSend,
    };
};

export { resolveConfig };

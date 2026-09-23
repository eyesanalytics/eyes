import type { EyesConfig } from 'eyes-types';
import { init } from '~/index';
import { isBrowser } from '~/utils/is-browser';

const BOOLEAN_ATTRIBUTES = [
    ['data-debug', 'debug'],
    ['data-consent-required', 'consentRequired'],
    ['data-auto-pageview', 'autoPageview'],
    ['data-auto-outbound', 'autoOutbound'],
    ['data-hash-routing', 'hashRouting'],
] as const;

/**
 * Build an EyesConfig from a snippet script tag's data attributes.
 * Returns null when `data-site` is absent (manual-init page).
 * Only attributes that are actually set end up in the config, so
 * resolveConfig defaults stay in charge of everything else.
 */
const readScriptConfig = (script: Element): EyesConfig | null => {
    const siteId = script.getAttribute('data-site');

    if (!siteId) return null;

    const config: EyesConfig = { siteId };

    const endpoint = script.getAttribute('data-endpoint');
    if (endpoint !== null) config.endpoint = endpoint;

    for (const [attribute, key] of BOOLEAN_ATTRIBUTES) {
        const value = script.getAttribute(attribute);
        if (value !== null) config[key] = value !== 'false';
    }

    return config;
};

const findSnippetScript = (): Element | null => {
    const current = document.currentScript;

    if (current) return current;

    // currentScript is null for async/dynamically injected tags
    return document.querySelector('script[src*="eyes.js"][data-site]');
};

/**
 * Initialise from the script tag's data attributes, if present.
 * A page without `data-site` keeps working exactly as before via manual Eyes.init.
 */
const autoInit = (): void => {
    if (!isBrowser()) return;

    const script = findSnippetScript();

    if (!script) return;

    const config = readScriptConfig(script);

    if (!config) return;

    try {
        init(config);
    } catch (error) {
        console.error('[Eyes] Auto-init failed:', error);
    }
};

export { autoInit, readScriptConfig };

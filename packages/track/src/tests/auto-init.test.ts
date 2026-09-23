import type { EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_SITE_ID, testEyesConfig } from '~/tests/helpers';

// The browser entry auto-inits on import, so we reset modules and re-import
// with a fresh DOM script tag per test.

const noopPerformanceObserver = class {
    observe() {}
    disconnect() {}
};

const makeScript = (attributes: Record<string, string>): HTMLScriptElement => {
    const script = document.createElement('script');
    script.src = 'https://cdn.eyes.dev/v1/eyes.js';
    for (const [name, value] of Object.entries(attributes)) {
        script.setAttribute(name, value);
    }

    return script;
};

const setCurrentScript = (script: HTMLScriptElement | null) => {
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
};

describe('readScriptConfig', () => {
    const importModule = () => import('~/auto-init.js');

    it('returns null without data-site', async () => {
        const { readScriptConfig } = await importModule();

        expect(readScriptConfig(makeScript({}))).toBeNull();
        expect(readScriptConfig(makeScript({ 'data-debug': 'true' }))).toBeNull();
    });

    it('returns siteId as a string with no other keys when only data-site is set', async () => {
        const { readScriptConfig } = await importModule();

        const config = readScriptConfig(makeScript({ 'data-site': TEST_SITE_ID }));

        expect(config).toEqual({ siteId: TEST_SITE_ID });
        expect(typeof config?.siteId).toBe('string');
    });

    it('maps data-endpoint to endpoint', async () => {
        const { readScriptConfig } = await importModule();

        const config = readScriptConfig(
            makeScript({ 'data-site': TEST_SITE_ID, 'data-endpoint': 'https://proxy.test' }),
        );

        expect(config?.endpoint).toBe('https://proxy.test');
    });

    it('maps boolean attributes: "false" is false, anything else is true', async () => {
        const { readScriptConfig } = await importModule();

        const config = readScriptConfig(
            makeScript({
                'data-site': TEST_SITE_ID,
                'data-debug': '',
                'data-consent-required': 'false',
                'data-auto-pageview': 'true',
                'data-auto-outbound': 'yes',
                'data-hash-routing': 'false',
            }),
        );

        expect(config).toEqual({
            siteId: TEST_SITE_ID,
            debug: true,
            consentRequired: false,
            autoPageview: true,
            autoOutbound: true,
            hashRouting: false,
        });
    });
});

describe('auto-init (browser entry)', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();

        fetchSpy = vi.fn().mockResolvedValue(new Response());
        vi.stubGlobal('fetch', fetchSpy);
        vi.stubGlobal('PerformanceObserver', noopPerformanceObserver);

        // Not a bot
        Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Normal Browser');

        sessionStorage.clear();
    });

    afterEach(() => {
        setCurrentScript(null);
        document.head.innerHTML = '';
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const importModule = () => import('~/browser.js');

    it('auto-inits from currentScript with data-site', async () => {
        setCurrentScript(
            makeScript({
                'data-site': TEST_SITE_ID,
                'data-endpoint': 'https://analytics.test',
                'data-auto-pageview': 'false',
            }),
        );

        const { track, flush, shutdown } = await importModule();

        track('AutoInit', { via: 'snippet' });
        await flush();

        expect(fetchSpy).toHaveBeenCalled();
        const [url, options] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://analytics.test/v1/events');

        const body: EyesEvent[] = JSON.parse(options.body);
        expect(body.some(event => event.name === 'AutoInit')).toBe(true);

        await shutdown();
    });

    it('falls back to querying the script tag when currentScript is null', async () => {
        setCurrentScript(null);
        const script = makeScript({
            'data-site': TEST_SITE_ID,
            'data-endpoint': 'https://analytics.test',
            'data-auto-pageview': 'false',
        });
        // Non-JS type keeps happy-dom from trying to fetch the src
        script.type = 'text/plain';
        document.head.append(script);

        const { track, flush, shutdown } = await importModule();

        track('FallbackInit');
        await flush();

        expect(fetchSpy).toHaveBeenCalled();
        expect(fetchSpy.mock.calls[0][0]).toBe('https://analytics.test/v1/events');

        await shutdown();
    });

    it('does not auto-init without data-site', async () => {
        setCurrentScript(makeScript({}));

        const { track, flush } = await importModule();

        track('NoAutoInit');
        await flush();

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('invalid site id logs an error instead of throwing', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        setCurrentScript(makeScript({ 'data-site': 'not-a-site-id' }));

        const { track, flush } = await importModule();

        expect(errorSpy).toHaveBeenCalledWith('[Eyes] Auto-init failed:', expect.any(Error));

        track('AfterInvalid');
        await flush();

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('manual init after auto-init returns the existing instance', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setCurrentScript(
            makeScript({
                'data-site': TEST_SITE_ID,
                'data-endpoint': 'https://analytics.test',
                'data-auto-pageview': 'false',
            }),
        );

        const { init, flush, shutdown, track } = await importModule();

        const api = init(testEyesConfig({ debug: true, autoPageview: false }));

        expect(warnSpy).toHaveBeenCalledWith(
            '[Eyes] Already initialised, returning existing instance',
        );

        // Same tracker: both entry points share the queue
        track('FromModule');
        api.track('FromManualInit');
        await flush();

        const body: EyesEvent[] = JSON.parse(fetchSpy.mock.calls[0][1].body);
        const names = body.map(event => event.name);
        expect(names).toContain('FromModule');
        expect(names).toContain('FromManualInit');

        await shutdown();
    });

    it('manual init still works when no data-site is present', async () => {
        setCurrentScript(makeScript({}));

        const { init, shutdown } = await importModule();

        const api = init(
            testEyesConfig({ endpoint: 'https://analytics.test', autoPageview: false }),
        );

        api.track('ManualOnly');
        await api.flush();

        expect(fetchSpy).toHaveBeenCalled();
        expect(fetchSpy.mock.calls[0][0]).toBe('https://analytics.test/v1/events');

        await shutdown();
    });
});

import type { EyesEvent } from '@eyes/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to reset the singleton between tests, so we import via dynamic import
// after resetting modules each time.

const noopPerformanceObserver = class {
    observe() {}
    disconnect() {}
};

describe('init (integration)', () => {
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
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const importModule = () => import('~/index.js');

    it('returns a working API with track, page, flush, shutdown', async () => {
        const { init } = await importModule();
        const api = init({ endpoint: 'https://example.com' });

        expect(api).toHaveProperty('track');
        expect(api).toHaveProperty('page');
        expect(api).toHaveProperty('flush');
        expect(api).toHaveProperty('shutdown');
        expect(typeof api.track).toBe('function');
        expect(typeof api.flush).toBe('function');

        await api.shutdown();
    });

    it('track → flush sends events via fetch', async () => {
        const { init } = await importModule();
        const api = init({ endpoint: 'https://analytics.test', autoPageview: false });

        api.track('Signup', { plan: 'pro' });
        await api.flush();

        expect(fetchSpy).toHaveBeenCalled();
        const [url, options] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://analytics.test/v1/events');

        const body: EyesEvent[] = JSON.parse(options.body);
        const signupEvent = body.find(e => e.name === 'Signup');
        expect(signupEvent).toBeDefined();
        expect(signupEvent?.type).toBe('event');
        expect(signupEvent?.props).toEqual({ plan: 'pro' });

        await api.shutdown();
    });

    it('calling init twice returns the same instance', async () => {
        const { init } = await importModule();

        const first = init({ endpoint: 'https://example.com', autoPageview: false });
        const second = init({ endpoint: 'https://example.com', autoPageview: false });

        // They should behave as the same tracker (shared queue)
        first.track('event-from-first');
        second.track('event-from-second');
        await first.flush();

        expect(fetchSpy).toHaveBeenCalled();
        const body: EyesEvent[] = JSON.parse(fetchSpy.mock.calls[0][1].body);
        const names = body.map(e => e.name);
        expect(names).toContain('event-from-first');
        expect(names).toContain('event-from-second');

        await first.shutdown();
    });

    it('beforeSend can modify events', async () => {
        const { init } = await importModule();
        const api = init({
            endpoint: 'https://example.com',
            autoPageview: false,
            beforeSend: event => ({
                ...event,
                props: { ...event.props, injected: true },
            }),
        });

        api.track('Test');
        await api.flush();

        const body: EyesEvent[] = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body[0].props?.injected).toBe(true);

        await api.shutdown();
    });

    it('beforeSend returning null drops events', async () => {
        const { init } = await importModule();
        const api = init({
            endpoint: 'https://example.com',
            autoPageview: false,
            beforeSend: () => null,
        });

        api.track('Dropped');
        await api.flush();

        // fetch should not be called because the queue is empty
        expect(fetchSpy).not.toHaveBeenCalled();

        await api.shutdown();
    });

    it('shutdown flushes remaining events', async () => {
        const { init } = await importModule();
        const api = init({ endpoint: 'https://example.com', autoPageview: false });

        api.track('BeforeShutdown');
        await api.shutdown();

        expect(fetchSpy).toHaveBeenCalled();
        const body: EyesEvent[] = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.some(e => e.name === 'BeforeShutdown')).toBe(true);
    });

    it('module-level track/page/flush work after init', async () => {
        const { init, track, flush, shutdown } = await importModule();
        init({ endpoint: 'https://example.com', autoPageview: false });

        track('ModuleLevel', { source: 'convenience' });
        await flush();

        expect(fetchSpy).toHaveBeenCalled();
        const body: EyesEvent[] = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.some(e => e.name === 'ModuleLevel')).toBe(true);

        await shutdown();
    });

    it('module-level functions are noops before init', async () => {
        const { track, flush } = await importModule();

        // These should not throw
        track('NoInit');
        await flush();

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('shutdown allows re-init', async () => {
        const mod = await importModule();
        const api1 = mod.init({ endpoint: 'https://example.com', autoPageview: false });
        await api1.shutdown();

        fetchSpy.mockClear();

        const api2 = mod.init({ endpoint: 'https://example.com', autoPageview: false });
        api2.track('AfterReInit');
        await api2.flush();

        expect(fetchSpy).toHaveBeenCalled();
        const body: EyesEvent[] = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.some(e => e.name === 'AfterReInit')).toBe(true);

        await api2.shutdown();
    });
});

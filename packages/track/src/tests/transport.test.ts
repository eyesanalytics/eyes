import type { EyesEvent } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '~/config';
import { TEST_SITE_ID, testEyesConfig } from '~/tests/helpers';
import { createTransport } from '~/transport';

const makeEvent = (overrides?: Partial<EyesEvent>): EyesEvent => ({
    type: 'event',
    name: 'test',
    url: 'https://example.com',
    sessionId: 'test-session',
    timestamp: Date.now(),
    ...overrides,
});

const noopLogger = { info: vi.fn(), event: vi.fn(), warn: vi.fn() };

const makeConfig = (overrides = {}) => resolveConfig(testEyesConfig(overrides));

describe('transport', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        fetchSpy = vi.fn().mockResolvedValue(new Response());
        vi.stubGlobal('fetch', fetchSpy);

        // Ensure not detected as a bot
        Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Normal Browser');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('enqueues events and flushes them via fetch', async () => {
        const config = makeConfig();
        const transport = createTransport(config, noopLogger);

        transport.enqueue(makeEvent({ name: 'click' }));
        transport.enqueue(makeEvent({ name: 'signup' }));
        await transport.flush();

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, options] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://example.com/v1/events');
        expect(options.method).toBe('POST');
        expect(options.headers['X-Eyes-Site-Id']).toBe(TEST_SITE_ID);
        expect(options.keepalive).toBe(true);
        expect(options.headers['Content-Type']).toBe('application/json');

        const body = JSON.parse(options.body);
        expect(body).toHaveLength(2);
        expect(body[0].name).toBe('click');
        expect(body[1].name).toBe('signup');
    });

    it('does not flush when queue is empty', async () => {
        const transport = createTransport(makeConfig(), noopLogger);
        await transport.flush();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('auto-flushes when maxBatchSize is reached', () => {
        const config = makeConfig({ maxBatchSize: 3 });
        const transport = createTransport(config, noopLogger);

        transport.enqueue(makeEvent());
        transport.enqueue(makeEvent());
        expect(fetchSpy).not.toHaveBeenCalled();

        transport.enqueue(makeEvent()); // triggers flush
        expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('auto-flushes on a timer interval', async () => {
        const config = makeConfig({ flushInterval: 2000 });
        const transport = createTransport(config, noopLogger);
        transport.start();

        transport.enqueue(makeEvent());
        expect(fetchSpy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2000);
        expect(fetchSpy).toHaveBeenCalledOnce();

        transport.stop();
    });

    it('does not resend a batch when fetch rejects', async () => {
        fetchSpy.mockRejectedValueOnce(new Error('fetch failed'));
        const beaconSpy = vi.fn().mockReturnValue(true);
        navigator.sendBeacon = beaconSpy;

        const transport = createTransport(makeConfig(), noopLogger);
        transport.enqueue(makeEvent());
        await transport.flush();

        // A keepalive request can arrive even when its promise rejects, so a second copy would
        // double count.
        expect(beaconSpy).not.toHaveBeenCalled();
        expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('flushes on pagehide with a beacon that carries the site id', () => {
        const beaconSpy = vi.fn().mockReturnValue(true);
        navigator.sendBeacon = beaconSpy;

        const transport = createTransport(makeConfig(), noopLogger);
        transport.start();
        transport.enqueue(makeEvent({ name: 'leave' }));
        window.dispatchEvent(new Event('pagehide'));

        expect(beaconSpy).toHaveBeenCalledOnce();
        expect(beaconSpy.mock.calls[0][0]).toBe(
            `https://example.com/v1/events?site_id=${TEST_SITE_ID}`,
        );
        expect(JSON.parse(beaconSpy.mock.calls[0][1])[0].name).toBe('leave');
        expect(fetchSpy).not.toHaveBeenCalled();

        transport.stop();
    });

    it('falls back to a keepalive fetch when the browser refuses the beacon', () => {
        navigator.sendBeacon = vi.fn().mockReturnValue(false);

        const transport = createTransport(makeConfig(), noopLogger);
        transport.start();
        transport.enqueue(makeEvent());
        window.dispatchEvent(new Event('pagehide'));

        expect(fetchSpy).toHaveBeenCalledOnce();
        expect(fetchSpy.mock.calls[0][1].keepalive).toBe(true);

        transport.stop();
    });

    it('silently drops events when bot is detected', async () => {
        Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });

        const transport = createTransport(makeConfig(), noopLogger);
        transport.enqueue(makeEvent());
        await transport.flush();

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('stop clears the flush interval', () => {
        const config = makeConfig({ flushInterval: 1000 });
        const transport = createTransport(config, noopLogger);
        transport.start();

        transport.enqueue(makeEvent());
        transport.stop();

        vi.advanceTimersByTime(5000);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('start logs and disables when bot detected', () => {
        Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });

        const logger = { info: vi.fn(), event: vi.fn(), warn: vi.fn() };
        const transport = createTransport(makeConfig(), logger);
        transport.start();

        expect(logger.info).toHaveBeenCalledWith('Bot detected, tracking disabled');
    });
});

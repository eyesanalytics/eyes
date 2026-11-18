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

const makeLogger = () => ({ info: vi.fn(), event: vi.fn(), warn: vi.fn() });

const setVisibility = (state: DocumentVisibilityState): void => {
    Object.defineProperty(document, 'visibilityState', {
        value: state,
        configurable: true,
        writable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
};

const rateLimited = (retryAfter = '5') =>
    new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } });

/** A fetch that stays in flight until the returned function settles it. */
const pendingFetch = (spy: ReturnType<typeof vi.fn>): (() => void) => {
    let settle = () => {};
    spy.mockImplementationOnce(
        () =>
            new Promise<Response>(resolve => {
                settle = () => resolve(new Response());
            }),
    );

    return () => settle();
};

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
        expect(url).toBe(`https://example.com/v1/events?site_id=${TEST_SITE_ID}`);
        expect(options.method).toBe('POST');
        expect(options.keepalive).toBe(true);
        // A simple CORS request: a safelisted content type and no custom header, so no preflight
        expect(options.headers).toEqual({ 'Content-Type': 'text/plain' });

        const body = JSON.parse(options.body);
        expect(body).toHaveLength(2);
        expect(body[0].name).toBe('click');
        expect(body[1].name).toBe('signup');
    });

    it('stamps every event with the time its batch is sent', async () => {
        vi.setSystemTime(1_750_000_000_000);
        const transport = createTransport(makeConfig(), noopLogger);

        transport.enqueue(makeEvent({ name: 'early', timestamp: 1_749_999_990_000 }));
        transport.enqueue(makeEvent({ name: 'late', timestamp: 1_749_999_995_000 }));
        vi.setSystemTime(1_750_000_002_000);
        await transport.flush();

        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body).toEqual([
            expect.objectContaining({ timestamp: 1_749_999_990_000, sentAt: 1_750_000_002_000 }),
            expect.objectContaining({ timestamp: 1_749_999_995_000, sentAt: 1_750_000_002_000 }),
        ]);
    });

    it('stamps a retried batch with the time of the retry', async () => {
        vi.setSystemTime(1_750_000_000_000);
        fetchSpy.mockResolvedValueOnce(
            new Response(null, { status: 429, headers: { 'Retry-After': '5' } }),
        );

        const transport = createTransport(makeConfig(), noopLogger);
        transport.enqueue(makeEvent({ timestamp: 1_750_000_000_000 }));
        await transport.flush();
        await vi.advanceTimersByTimeAsync(5000);

        expect(JSON.parse(fetchSpy.mock.calls[0][1].body)[0].sentAt).toBe(1_750_000_000_000);
        expect(JSON.parse(fetchSpy.mock.calls[1][1].body)[0]).toMatchObject({
            timestamp: 1_750_000_000_000,
            sentAt: 1_750_000_005_000,
        });
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

    it('runs no flush timer while the queue is empty', async () => {
        const transport = createTransport(makeConfig({ flushInterval: 2000 }), noopLogger);
        transport.start();
        expect(vi.getTimerCount()).toBe(0);

        transport.enqueue(makeEvent());
        transport.enqueue(makeEvent());
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(2000);
        expect(fetchSpy).toHaveBeenCalledOnce();
        expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toHaveLength(2);
        expect(vi.getTimerCount()).toBe(0);

        transport.stop();
    });

    it('gives events queued while a flush is in flight a timer of their own', async () => {
        const settle = pendingFetch(fetchSpy);
        const transport = createTransport(makeConfig({ flushInterval: 2000 }), noopLogger);
        transport.start();

        transport.enqueue(makeEvent({ name: 'first' }));
        await vi.advanceTimersByTimeAsync(2000);
        transport.enqueue(makeEvent({ name: 'second' }));
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(2000);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const body = JSON.parse(fetchSpy.mock.calls[1][1].body);
        expect(body).toHaveLength(1);
        expect(body[0].name).toBe('second');

        settle();
        transport.stop();
    });

    it('cancels the flush timer when the queue is flushed by hand or by batch size', async () => {
        const transport = createTransport(
            makeConfig({ flushInterval: 2000, maxBatchSize: 2 }),
            noopLogger,
        );
        transport.start();

        transport.enqueue(makeEvent());
        await transport.flush();
        expect(vi.getTimerCount()).toBe(0);

        transport.enqueue(makeEvent());
        transport.enqueue(makeEvent());
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        transport.stop();
    });

    it('arms the flush timer from start until stop only', async () => {
        const transport = createTransport(makeConfig({ flushInterval: 2000 }), noopLogger);

        // Queued before start: flushed on the first timer
        transport.enqueue(makeEvent({ name: 'early' }));
        expect(vi.getTimerCount()).toBe(0);
        transport.start();
        await vi.advanceTimersByTimeAsync(2000);
        expect(JSON.parse(fetchSpy.mock.calls[0][1].body)[0].name).toBe('early');

        // Queued after stop: no timer, but a flush by hand still sends it
        transport.stop();
        transport.enqueue(makeEvent({ name: 'late' }));
        expect(vi.getTimerCount()).toBe(0);
        await transport.flush();
        expect(JSON.parse(fetchSpy.mock.calls[1][1].body)[0].name).toBe('late');
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

    it('retries a batch once after the Retry-After delay on a 429', async () => {
        fetchSpy.mockResolvedValueOnce(
            new Response(null, { status: 429, headers: { 'Retry-After': '5' } }),
        );

        const transport = createTransport(makeConfig(), noopLogger);
        transport.enqueue(makeEvent({ name: 'limited' }));
        await transport.flush();

        expect(fetchSpy).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(4999);
        expect(fetchSpy).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(1);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(fetchSpy.mock.calls[1][0]).toBe(fetchSpy.mock.calls[0][0]);
        expect(JSON.parse(fetchSpy.mock.calls[1][1].body)[0].name).toBe('limited');
    });

    it('retries a 503 without Retry-After after a default delay', async () => {
        fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));

        const transport = createTransport(makeConfig(), noopLogger);
        transport.enqueue(makeEvent());
        await transport.flush();

        await vi.advanceTimersByTimeAsync(9999);
        expect(fetchSpy).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(1);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('reads a Retry-After date and caps the delay at a minute', async () => {
        fetchSpy
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 429,
                    headers: { 'Retry-After': new Date(Date.now() + 3000).toUTCString() },
                }),
            )
            .mockResolvedValueOnce(
                new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }),
            );

        const transport = createTransport(makeConfig(), noopLogger);
        transport.enqueue(makeEvent({ name: 'dated' }));
        await transport.flush();
        transport.enqueue(makeEvent({ name: 'capped' }));
        await transport.flush();

        // An HTTP date has second precision, so the delay is at most three seconds
        await vi.advanceTimersByTimeAsync(3000);
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(JSON.parse(fetchSpy.mock.calls[2][1].body)[0].name).toBe('dated');

        await vi.advanceTimersByTimeAsync(57_000);
        expect(fetchSpy).toHaveBeenCalledTimes(4);
        expect(JSON.parse(fetchSpy.mock.calls[3][1].body)[0].name).toBe('capped');
    });

    it('retries a rejected batch only once', async () => {
        fetchSpy.mockResolvedValue(
            new Response(null, { status: 429, headers: { 'Retry-After': '1' } }),
        );

        const transport = createTransport(makeConfig(), noopLogger);
        transport.enqueue(makeEvent());
        await transport.flush();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('does not retry other error responses', async () => {
        fetchSpy.mockResolvedValueOnce(new Response(null, { status: 400 }));

        const transport = createTransport(makeConfig(), noopLogger);
        transport.enqueue(makeEvent());
        await transport.flush();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('logs the status and the reason of every refused batch in debug mode', async () => {
        fetchSpy
            .mockResolvedValueOnce(
                new Response('Payload contains no valid events.', { status: 400 }),
            )
            .mockResolvedValueOnce(rateLimited('1'))
            .mockResolvedValueOnce(new Response('Too many requests.', { status: 429 }));
        const logger = makeLogger();

        const transport = createTransport(makeConfig({ debug: true }), logger);
        transport.enqueue(makeEvent());
        await transport.flush();
        transport.enqueue(makeEvent());
        await transport.flush();
        await vi.advanceTimersByTimeAsync(1000);

        expect(logger.warn.mock.calls).toEqual([
            ['Server refused 1 event(s) with status 400', 'Payload contains no valid events.'],
            ['Server refused 1 event(s) with status 429', ''],
            ['Server refused 1 event(s) with status 429', 'Too many requests.'],
        ]);
    });

    it('does not read the response of a refused batch outside debug mode', async () => {
        const response = new Response('Payload contains no valid events.', { status: 400 });
        const text = vi.spyOn(response, 'text');
        fetchSpy.mockResolvedValueOnce(response);

        const transport = createTransport(makeConfig(), noopLogger);
        transport.enqueue(makeEvent());
        await transport.flush();

        expect(text).not.toHaveBeenCalled();
    });

    it('sends a batch waiting for its retry as a beacon when the page is hidden, once', async () => {
        fetchSpy.mockResolvedValueOnce(rateLimited());
        const beaconSpy = vi.fn().mockReturnValue(true);
        navigator.sendBeacon = beaconSpy;

        const transport = createTransport(makeConfig(), noopLogger);
        transport.start();
        transport.enqueue(makeEvent({ name: 'limited' }));
        await transport.flush();
        vi.advanceTimersByTime(2000);

        // Stamped with the time it goes out, like a retry from the timer
        setVisibility('hidden');
        expect(beaconSpy).toHaveBeenCalledOnce();
        expect(JSON.parse(beaconSpy.mock.calls[0][1])[0]).toMatchObject({
            name: 'limited',
            sentAt: Date.now(),
        });

        // The page comes back and goes again: the batch has had its one resend
        setVisibility('visible');
        setVisibility('hidden');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(beaconSpy).toHaveBeenCalledOnce();
        expect(fetchSpy).toHaveBeenCalledOnce();

        setVisibility('visible');
        transport.stop();
    });

    it('sends a waiting batch with fetch on pagehide when the beacon is refused, once', async () => {
        fetchSpy.mockResolvedValue(rateLimited());
        navigator.sendBeacon = vi.fn().mockReturnValue(false);

        const transport = createTransport(makeConfig(), noopLogger);
        transport.start();
        transport.enqueue(makeEvent({ name: 'limited' }));
        await transport.flush();

        window.dispatchEvent(new Event('pagehide'));
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetchSpy.mock.calls[1][1].body)[0].name).toBe('limited');

        // Refused again, and not sent a third time
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        transport.stop();
    });

    it('sends a body over the keepalive quota without keepalive, counting bytes', async () => {
        const transport = createTransport(makeConfig(), noopLogger);

        // 20,000 characters, but 60,000 bytes of UTF-8
        transport.enqueue(makeEvent({ props: { note: '€'.repeat(20_000) } }));
        await transport.flush();
        transport.enqueue(makeEvent());
        await transport.flush();

        expect(fetchSpy.mock.calls[0][1].keepalive).toBe(false);
        expect(fetchSpy.mock.calls[1][1].keepalive).toBe(true);
    });

    it('keeps the keepalive requests in flight under the quota together', async () => {
        const settle = pendingFetch(fetchSpy);
        const transport = createTransport(makeConfig(), noopLogger);
        const batch = () => makeEvent({ props: { note: 'x'.repeat(30_000) } });

        transport.enqueue(batch());
        transport.flush();
        transport.enqueue(batch());
        await transport.flush();

        settle();
        await vi.advanceTimersByTimeAsync(0);
        transport.enqueue(batch());
        await transport.flush();

        expect(fetchSpy.mock.calls.map(([, options]) => options.keepalive)).toEqual([
            true,
            false,
            true,
        ]);
    });

    it('cancels a pending retry when stopped', async () => {
        fetchSpy.mockResolvedValueOnce(
            new Response(null, { status: 429, headers: { 'Retry-After': '5' } }),
        );

        const transport = createTransport(makeConfig(), noopLogger);
        transport.start();
        transport.enqueue(makeEvent());
        await transport.flush();
        transport.stop();

        await vi.advanceTimersByTimeAsync(60_000);
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
        expect(JSON.parse(beaconSpy.mock.calls[0][1])[0]).toMatchObject({
            name: 'leave',
            sentAt: Date.now(),
        });
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

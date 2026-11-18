import type { EyesConfig, EyesEvent } from 'eyes-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENDPOINT, resolveConfig } from '~/config';
import { TEST_SITE_ID, testEyesConfig } from '~/tests/helpers';

const event: EyesEvent = {
    type: 'event',
    url: 'https://example.com',
    sessionId: 'test',
    timestamp: 0,
};

const throwingHook = (): EyesEvent | null => {
    throw new Error('beforeSend failed');
};

describe('resolveConfig', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('throws when siteId is missing', () => {
        expect(() => resolveConfig({} as EyesConfig)).toThrow('`siteId` is required');
    });

    it('throws when siteId is invalid', () => {
        expect(() => resolveConfig({ siteId: 'abc' })).toThrow(
            '`siteId` must be a 9-digit numeric string',
        );
    });

    it('defaults endpoint to the hosted ingress when omitted', () => {
        const config = resolveConfig({ siteId: TEST_SITE_ID });
        expect(config.endpoint).toBe(DEFAULT_ENDPOINT);
    });

    it('defaults endpoint when an empty string is supplied', () => {
        const config = resolveConfig({ siteId: TEST_SITE_ID, endpoint: '   ' });
        expect(config.endpoint).toBe(DEFAULT_ENDPOINT);
    });

    it('strips trailing slashes from endpoint', () => {
        const config = resolveConfig(testEyesConfig({ endpoint: 'https://example.com///' }));
        expect(config.endpoint).toBe('https://example.com');
    });

    it('fills in all defaults', () => {
        const config = resolveConfig(testEyesConfig());
        expect(config).toMatchObject({
            endpoint: 'https://example.com',
            siteId: TEST_SITE_ID,
            debug: false,
            autoPageview: true,
            autoOutbound: true,
            hashRouting: false,
            flushInterval: 5000,
            maxBatchSize: 10,
        });
        expect(typeof config.beforeSend).toBe('function');
    });

    it('preserves user overrides', () => {
        const config = resolveConfig(testEyesConfig({ debug: true }));
        expect(config.debug).toBe(true);
    });

    it('runs a custom beforeSend hook', () => {
        const changed: EyesEvent = { ...event, name: 'Changed' };
        const hook = vi.fn(() => changed);
        const config = resolveConfig(testEyesConfig({ beforeSend: hook }));

        expect(config.beforeSend(event)).toBe(changed);
        expect(hook).toHaveBeenCalledWith(event);
    });

    it('default beforeSend is a pass-through', () => {
        const config = resolveConfig(testEyesConfig());
        expect(config.beforeSend(event)).toBe(event);
    });

    it('uses the default for an option passed as undefined', () => {
        const config = resolveConfig(
            testEyesConfig({
                debug: undefined,
                consentRequired: undefined,
                autoPageview: undefined,
                autoOutbound: undefined,
                hashRouting: undefined,
                flushInterval: undefined,
                maxBatchSize: undefined,
                beforeSend: undefined,
            }),
        );

        expect(config).toMatchObject({
            debug: false,
            consentRequired: true,
            autoPageview: true,
            autoOutbound: true,
            hashRouting: false,
            flushInterval: 5000,
            maxBatchSize: 10,
        });
        expect(config.beforeSend(event)).toBe(event);
    });

    it('keeps maxBatchSize within the 50 events the ingress accepts', () => {
        expect(resolveConfig(testEyesConfig({ maxBatchSize: 100 })).maxBatchSize).toBe(50);
        expect(resolveConfig(testEyesConfig({ maxBatchSize: 0 })).maxBatchSize).toBe(1);
        expect(resolveConfig(testEyesConfig({ maxBatchSize: -5 })).maxBatchSize).toBe(1);
        expect(resolveConfig(testEyesConfig({ maxBatchSize: 25 })).maxBatchSize).toBe(25);
    });

    it('keeps flushInterval at 1000 ms or more', () => {
        expect(resolveConfig(testEyesConfig({ flushInterval: 10 })).flushInterval).toBe(1000);
        expect(resolveConfig(testEyesConfig({ flushInterval: -1 })).flushInterval).toBe(1000);
        expect(resolveConfig(testEyesConfig({ flushInterval: 30_000 })).flushInterval).toBe(30_000);
    });

    it('uses the default for a batch size or interval that is not a number', () => {
        const config = resolveConfig(
            testEyesConfig({
                flushInterval: Number.NaN,
                maxBatchSize: '20' as unknown as number,
            }),
        );

        expect(config.flushInterval).toBe(5000);
        expect(config.maxBatchSize).toBe(10);
        expect(
            resolveConfig(testEyesConfig({ flushInterval: Number.POSITIVE_INFINITY }))
                .flushInterval,
        ).toBe(5000);
    });

    it('logs a changed value in debug mode only', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        resolveConfig(testEyesConfig({ maxBatchSize: 100 }));
        expect(warn).not.toHaveBeenCalled();

        resolveConfig(testEyesConfig({ debug: true, maxBatchSize: 100, flushInterval: 5000 }));
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]?.[0]).toContain('maxBatchSize');
        expect(warn.mock.calls[0]).toContain(100);
    });

    it('drops an event when beforeSend throws', () => {
        const config = resolveConfig(testEyesConfig({ beforeSend: throwingHook }));

        expect(config.beforeSend(event)).toBeNull();
    });

    it('logs a throwing beforeSend in debug mode only', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        resolveConfig(testEyesConfig({ beforeSend: throwingHook })).beforeSend(event);
        expect(warn).not.toHaveBeenCalled();

        resolveConfig(testEyesConfig({ debug: true, beforeSend: throwingHook })).beforeSend(event);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]?.[0]).toContain('beforeSend');
        expect(warn.mock.calls[0]?.at(-1)).toBeInstanceOf(Error);
    });
});

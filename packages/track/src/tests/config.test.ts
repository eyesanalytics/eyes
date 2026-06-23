import type { EyesConfig, EyesEvent } from 'eyes-types';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENDPOINT, resolveConfig } from '~/config';
import { TEST_SITE_ID, testEyesConfig } from '~/tests/helpers';

describe('resolveConfig', () => {
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

    it('preserves a custom beforeSend hook', () => {
        const hook = () => null;
        const config = resolveConfig(testEyesConfig({ beforeSend: hook }));
        expect(config.beforeSend).toBe(hook);
    });

    it('default beforeSend is a pass-through', () => {
        const config = resolveConfig(testEyesConfig());
        const event: EyesEvent = {
            type: 'event',
            url: 'https://example.com',
            sessionId: 'test',
            timestamp: 0,
        };
        expect(config.beforeSend(event)).toBe(event);
    });
});

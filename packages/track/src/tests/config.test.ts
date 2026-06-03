import type { EyesConfig, EyesEvent } from 'eyes-types';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '~/config';

describe('resolveConfig', () => {
    it('throws when endpoint is missing', () => {
        expect(() => resolveConfig({} as unknown as EyesConfig)).toThrow('`endpoint` is required');
    });

    it('throws when endpoint is an empty string', () => {
        expect(() => resolveConfig({ endpoint: '' })).toThrow('`endpoint` is required');
    });

    it('strips trailing slashes from endpoint', () => {
        const config = resolveConfig({ endpoint: 'https://example.com///' });
        expect(config.endpoint).toBe('https://example.com');
    });

    it('fills in all defaults', () => {
        const config = resolveConfig({ endpoint: 'https://example.com' });
        expect(config).toMatchObject({
            endpoint: 'https://example.com',
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
        const config = resolveConfig({
            endpoint: 'https://example.com',
            debug: true,
        });
        expect(config.debug).toBe(true);
    });

    it('preserves a custom beforeSend hook', () => {
        const hook = () => null;
        const config = resolveConfig({ endpoint: 'https://example.com', beforeSend: hook });
        expect(config.beforeSend).toBe(hook);
    });

    it('default beforeSend is a pass-through', () => {
        const config = resolveConfig({ endpoint: 'https://example.com' });
        const event: EyesEvent = {
            type: 'event',
            url: 'https://example.com',
            sessionId: 'test',
            timestamp: 0,
        };
        expect(config.beforeSend(event)).toBe(event);
    });
});

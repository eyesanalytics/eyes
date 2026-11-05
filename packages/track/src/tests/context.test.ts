import { afterEach, describe, expect, it } from 'vitest';
import { buildContext, currentUrl } from '~/context';

describe('context', () => {
    const originalHref = location.href;

    afterEach(() => {
        // Restore location
        history.replaceState(null, '', originalHref);
    });

    describe('buildContext', () => {
        it('returns the current URL without hash', () => {
            history.replaceState(null, '', '/test-page#section');
            const ctx = buildContext();
            expect(ctx.url).toBe(`${location.origin}/test-page`);
            expect(ctx.url).not.toContain('#');
        });

        it('returns only the url and referrer', () => {
            const ctx = buildContext();
            expect(Object.keys(ctx).sort()).toEqual(['referrer', 'url']);
        });

        it('excludes same-origin referrer', () => {
            Object.defineProperty(document, 'referrer', {
                value: `${location.origin}/previous-page`,
                configurable: true,
            });
            const ctx = buildContext();
            expect(ctx.referrer).toBeUndefined();
        });

        it('includes cross-origin referrer', () => {
            Object.defineProperty(document, 'referrer', {
                value: 'https://external-site.com/page',
                configurable: true,
            });
            const ctx = buildContext();
            expect(ctx.referrer).toBe('https://external-site.com/page');
        });

        it('excludes empty referrer', () => {
            Object.defineProperty(document, 'referrer', { value: '', configurable: true });
            const ctx = buildContext();
            expect(ctx.referrer).toBeUndefined();
        });
    });

    describe('currentUrl', () => {
        it('returns URL without hash', () => {
            history.replaceState(null, '', '/page#hash');
            expect(currentUrl()).toBe(`${location.origin}/page`);
        });

        it('returns URL as-is when there is no hash', () => {
            history.replaceState(null, '', '/clean-page');
            expect(currentUrl()).toBe(`${location.origin}/clean-page`);
        });
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBot } from '~/utils/is-bot';

declare global {
    interface Window {
        __phantom?: unknown;
        __puppeteer?: unknown;
        Cypress?: unknown;
    }
    interface Navigator {
        __nightmare?: unknown;
    }
}

describe('isBot', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        // Clean up injected globals
        delete navigator.__nightmare;
        delete window.__phantom;
        delete window.__puppeteer;
        delete window.Cypress;
    });

    it('returns false for a normal user agent', () => {
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        );
        Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
        expect(isBot()).toBe(false);
    });

    it('returns true when navigator.webdriver is set', () => {
        Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
        expect(isBot()).toBe(true);
    });

    it.each([
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Mozilla/5.0 (compatible; bingbot/2.0)',
        'Screaming Frog SEO Spider/19.0',
        'HeadlessChrome/120.0',
    ])('returns true for bot user agent: %s', ua => {
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
        expect(isBot()).toBe(true);
    });

    it('returns true when window.Cypress is present', () => {
        window.Cypress = true;
        expect(isBot()).toBe(true);
    });

    it('returns true when window.__puppeteer is present', () => {
        window.__puppeteer = true;
        expect(isBot()).toBe(true);
    });

    it('returns true when navigator.__nightmare is present', () => {
        navigator.__nightmare = true;
        expect(isBot()).toBe(true);
    });

    it('returns true when window.__phantom is present', () => {
        window.__phantom = true;
        expect(isBot()).toBe(true);
    });
});

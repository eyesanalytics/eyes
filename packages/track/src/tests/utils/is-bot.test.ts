import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const setUserAgent = (ua: string): void => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
};

describe('isBot', () => {
    beforeEach(() => {
        // happy-dom reports webdriver, so every test starts from a regular browser.
        Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        // Clean up injected globals
        delete navigator.__nightmare;
        delete window.__phantom;
        delete window.__puppeteer;
        delete window.Cypress;
    });

    it('returns false for a normal user agent', () => {
        setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
        expect(isBot()).toBe(false);
    });

    it('returns true when navigator.webdriver is set', () => {
        Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
        expect(isBot()).toBe(true);
    });

    it.each([
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.92 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
        'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/100.0.4896.88 Safari/537.36',
        'Mozilla/5.0 (compatible; Barkrowler/0.9; +https://babbar.tech/crawler)',
        'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
        'Screaming Frog SEO Spider/19.0',
    ])('returns true for bot user agent: %s', ua => {
        setUserAgent(ua);
        expect(isBot()).toBe(true);
    });

    it.each([
        'Mozilla/5.0 (Linux; Android 7.0; CUBOT X18) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 7.0; CUBOT X18 Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/93.0.4577.62 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 8.0.0; CUBOT_P20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Mobile Safari/537.36',
    ])('returns false for a CUBOT phone: %s', ua => {
        setUserAgent(ua);
        expect(isBot()).toBe(false);
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

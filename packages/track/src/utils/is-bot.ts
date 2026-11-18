import { isBrowser } from '~/utils/is-browser';

interface BotNavigator extends Navigator {
    __nightmare?: unknown;
}

interface BotWindow extends Window {
    __phantom?: unknown;
    __puppeteer?: unknown;
    Cypress?: unknown;
}

const BOT_PATTERN = /bot|crawl|spider|headless/i;

/**
 * Real devices whose name holds one of the words above, removed from the user agent before the
 * test: CUBOT phones send "CUBOT X18" or "CUBOT_P20". Removing them keeps the pattern free of a
 * lookbehind, which Safari before 16.4 cannot parse, and that would break the whole script.
 */
const DEVICE_NAMES = /cubot/gi;

/** Detect automated browsers and bots. */
const isBot = (): boolean => {
    if (!isBrowser()) return true;
    const nav = navigator as BotNavigator;
    const browserWindow = window as BotWindow;

    return !!(
        nav.webdriver ||
        nav.__nightmare ||
        browserWindow.__phantom ||
        browserWindow.__puppeteer ||
        browserWindow.Cypress ||
        BOT_PATTERN.test(nav.userAgent.replace(DEVICE_NAMES, ''))
    );
};

export { isBot };

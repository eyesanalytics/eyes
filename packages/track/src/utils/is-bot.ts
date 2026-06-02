import { isBrowser } from '~/utils/is-browser';

interface BotNavigator extends Navigator {
    __nightmare?: unknown;
}

interface BotWindow extends Window {
    __phantom?: unknown;
    __puppeteer?: unknown;
    Cypress?: unknown;
}

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
        /bot|crawl|spider|headless/i.test(nav.userAgent)
    );
};

export { isBot };

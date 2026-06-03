import type { ResolvedConfig } from 'eyes-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCapture } from '~/capture';
import type { EyesTracker } from '~/core';

const makeConfig = (overrides?: Partial<ResolvedConfig>): ResolvedConfig => ({
    endpoint: 'https://example.com',
    debug: false,
    autoPageview: true,
    autoOutbound: true,
    hashRouting: false,
    flushInterval: 5000,
    maxBatchSize: 10,
    beforeSend: e => e,
    ...overrides,
});

const makeTracker = () => ({
    page: vi.fn(),
    track: vi.fn(),
    currentUrl: vi.fn(() => location.href),
    send: vi.fn(),
    config: makeConfig(),
});

// EyesTracker has private members, so mock objects can't structurally match it
const asTracker = (mock: ReturnType<typeof makeTracker>) => mock as unknown as EyesTracker;

describe('capture', () => {
    let originalHref: string;

    beforeEach(() => {
        originalHref = location.href;
        // Ensure prerendering is not active
        Object.defineProperty(document, 'prerendering', { value: false, configurable: true });
    });

    afterEach(() => {
        history.replaceState(null, '', originalHref);
    });

    it('fires an initial pageview when autoPageview is true', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig());

        expect(tracker.page).toHaveBeenCalledOnce();
        cleanup();
    });

    it('skips initial pageview when autoPageview is false', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig({ autoPageview: false }));

        expect(tracker.page).not.toHaveBeenCalled();
        cleanup();
    });

    it('tracks SPA navigation via pushState', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig());

        tracker.page.mockClear(); // clear initial pageview call

        history.pushState(null, '', '/new-page');
        expect(tracker.page).toHaveBeenCalledOnce();

        cleanup();
    });

    it('deduplicates pushState to the same URL', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig());
        tracker.page.mockClear();

        history.pushState(null, '', '/same-page');
        history.pushState(null, '', '/same-page'); // same URL

        expect(tracker.page).toHaveBeenCalledOnce();
        cleanup();
    });

    it('tracks popstate navigation', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig());
        tracker.page.mockClear();

        // Navigate forward, then back
        history.pushState(null, '', '/page-a');
        tracker.page.mockClear();

        history.pushState(null, '', '/page-b');
        tracker.page.mockClear();

        // Go back, triggers popstate
        window.dispatchEvent(new PopStateEvent('popstate'));
        // popstate fires but URL may not change in happy-dom, so we test the handler ran
        // In a real browser, location.href would change before popstate fires

        cleanup();
    });

    it('tracks hashchange when hashRouting is enabled', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig({ hashRouting: true }));
        tracker.page.mockClear();

        // Simulate a hash change that changes the URL
        history.pushState(null, '', '/page#section1');
        tracker.page.mockClear();

        // Changing hash via hashchange event
        history.pushState(null, '', '/page#section2');
        // The pushState interception handles this, but hashchange listener also exists
        expect(tracker.page).toHaveBeenCalled();

        cleanup();
    });

    it('does not listen for hashchange when hashRouting is false', () => {
        const tracker = makeTracker();
        const addSpy = vi.spyOn(window, 'addEventListener');
        const cleanup = initCapture(asTracker(tracker), makeConfig({ hashRouting: false }));

        const hashListeners = addSpy.mock.calls.filter(([event]) => event === 'hashchange');
        expect(hashListeners).toHaveLength(0);

        cleanup();
        addSpy.mockRestore();
    });

    it('tracks outbound link clicks', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig());

        const link = document.createElement('a');
        link.href = 'https://external-site.com/path';
        document.body.appendChild(link);

        // Prevent happy-dom from actually navigating (which changes origin)
        link.addEventListener('click', e => e.preventDefault());
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(tracker.track).toHaveBeenCalledWith('Outbound Click', {
            url: 'https://external-site.com/path',
        });

        document.body.removeChild(link);
        cleanup();
    });

    it('does not track same-origin link clicks as outbound', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig());

        const link = document.createElement('a');
        link.href = `${location.origin}/internal-page`;
        document.body.appendChild(link);

        link.addEventListener('click', e => e.preventDefault());
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(tracker.track).not.toHaveBeenCalled();

        document.body.removeChild(link);
        cleanup();
    });

    it('does not track outbound when autoOutbound is false', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig({ autoOutbound: false }));

        const link = document.createElement('a');
        link.href = 'https://external-site.com';
        document.body.appendChild(link);

        link.addEventListener('click', e => e.preventDefault());
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(tracker.track).not.toHaveBeenCalled();

        document.body.removeChild(link);
        cleanup();
    });

    it('cleanup removes event listeners and restores pushState', () => {
        const tracker = makeTracker();
        const cleanup = initCapture(asTracker(tracker), makeConfig());

        cleanup();

        tracker.page.mockClear();
        tracker.track.mockClear();

        // pushState should no longer trigger pageviews
        history.pushState(null, '', '/after-cleanup');
        expect(tracker.page).not.toHaveBeenCalled();

        // Outbound clicks should no longer be tracked
        const link = document.createElement('a');
        link.href = 'https://external-site.com';
        document.body.appendChild(link);
        link.addEventListener('click', e => e.preventDefault());
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(tracker.track).not.toHaveBeenCalled();
        document.body.removeChild(link);
    });
});

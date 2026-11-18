import type { ResolvedConfig } from 'eyes-types';
import { stripHash } from '~/context';
import type { EyesTracker } from '~/core';

interface PrerenderingDocument extends Document {
    prerendering?: boolean;
}

/**
 * Run the tracker's own work for a host navigation or a browser event. An error stays here: in a
 * patched pushState it would break the host app's navigation, and in a listener it would land in
 * the host app's error reporting.
 */
const guard =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
        try {
            fn(...args);
        } catch {
            // The host app goes on without this event
        }
    };

/**
 * Set up automatic tracking for:
 * - Initial pageview (handles prerendering)
 * - SPA navigation via pushState / popstate
 * - Hash-based routing (optional)
 * - Pages restored from the back/forward cache
 * - Outbound link clicks
 *
 * Returns a cleanup function.
 */
const initCapture = (tracker: EyesTracker, config: ResolvedConfig): (() => void) => {
    const cleanups: Array<() => void> = [];
    // Fragment navigation (an in-page anchor, Back between anchors) fires popstate too. Without hash
    // routing the fragment is not a page, so it must not count as a navigation.
    const navigationKey = (): string =>
        config.hashRouting ? location.href : stripHash(location.href);
    let lastUrl = navigationKey();
    const prerenderingDocument = document as PrerenderingDocument;

    // -----------------------------------------------------------------
    // Initial pageview
    // -----------------------------------------------------------------
    if (config.autoPageview) {
        if (!prerenderingDocument.prerendering) {
            tracker.page();
        }

        if (prerenderingDocument.prerendering) {
            // Wait until the page is actually shown
            const onActivate = guard(() => {
                tracker.page();
                document.removeEventListener('prerenderingchange', onActivate);
            });
            document.addEventListener('prerenderingchange', onActivate);
            cleanups.push(() => document.removeEventListener('prerenderingchange', onActivate));
        }
    }

    // -----------------------------------------------------------------
    // SPA navigation: pushState + popstate
    // -----------------------------------------------------------------
    if (config.autoPageview) {
        const originalPushState = history.pushState.bind(history);

        history.pushState = (...args: Parameters<typeof history.pushState>) => {
            originalPushState(...args);
            onNavigation();
        };

        const onPopState = () => onNavigation();
        window.addEventListener('popstate', onPopState);

        cleanups.push(() => {
            history.pushState = originalPushState;
            window.removeEventListener('popstate', onPopState);
        });

        // A back/forward cache restore shows the page again without running any script, so no
        // other listener sees it.
        const onPageShow = guard((event: PageTransitionEvent) => {
            if (!event.persisted) return;
            lastUrl = navigationKey();
            tracker.page();
        });
        window.addEventListener('pageshow', onPageShow);
        cleanups.push(() => window.removeEventListener('pageshow', onPageShow));

        // Hash-based routing
        if (config.hashRouting) {
            const onHashChange = () => onNavigation();
            window.addEventListener('hashchange', onHashChange);
            cleanups.push(() => window.removeEventListener('hashchange', onHashChange));
        }
    }

    // pushState, popstate and hashchange all come through here
    const onNavigation = guard((): void => {
        const current = navigationKey();
        if (current === lastUrl) return;
        lastUrl = current;
        tracker.page();
    });

    // -----------------------------------------------------------------
    // Outbound link tracking
    // -----------------------------------------------------------------
    if (config.autoOutbound) {
        // A primary click (also with ctrl or cmd) fires `click`; a middle click opens a new tab and
        // fires `auxclick`. Each event only counts its own button, so a browser that also fires
        // `click` for a middle click still counts it once.
        const onClick = guard((e: MouseEvent) => {
            const button = e.type === 'auxclick' ? 1 : 0;
            if (e.button !== button) return;

            const link = (e.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!link) return;

            // A malformed href throws here, and the guard ignores it
            const url = new URL(link.href, location.origin);
            if (url.host && url.host !== location.host) {
                // Links often carry tokens or emails in the query, and the report groups by page.
                tracker.track('Outbound Click', { url: `${url.origin}${url.pathname}` });
            }
        });

        document.addEventListener('click', onClick, { capture: true });
        document.addEventListener('auxclick', onClick, { capture: true });
        cleanups.push(() => {
            document.removeEventListener('click', onClick, { capture: true });
            document.removeEventListener('auxclick', onClick, { capture: true });
        });
    }

    return () => {
        for (const fn of cleanups) fn();
    };
};

export { initCapture };

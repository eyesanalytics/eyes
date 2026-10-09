import type { ResolvedConfig } from 'eyes-types';
import { stripHash } from '~/context';
import type { EyesTracker } from '~/core';

interface PrerenderingDocument extends Document {
    prerendering?: boolean;
}

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
            const onActivate = () => {
                tracker.page();
                document.removeEventListener('prerenderingchange', onActivate);
            };
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
        const onPageShow = (event: PageTransitionEvent) => {
            if (!event.persisted) return;
            lastUrl = navigationKey();
            tracker.page();
        };
        window.addEventListener('pageshow', onPageShow);
        cleanups.push(() => window.removeEventListener('pageshow', onPageShow));

        // Hash-based routing
        if (config.hashRouting) {
            const onHashChange = () => onNavigation();
            window.addEventListener('hashchange', onHashChange);
            cleanups.push(() => window.removeEventListener('hashchange', onHashChange));
        }
    }

    const onNavigation = (): void => {
        const current = navigationKey();
        if (current === lastUrl) return;
        lastUrl = current;
        tracker.page();
    };

    // -----------------------------------------------------------------
    // Outbound link tracking
    // -----------------------------------------------------------------
    if (config.autoOutbound) {
        const onClick = (e: MouseEvent) => {
            const link = (e.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!link) return;

            try {
                const url = new URL(link.href, location.origin);
                if (url.host && url.host !== location.host) {
                    tracker.track('Outbound Click', { url: link.href });
                }
            } catch {
                // Malformed href, ignore
            }
        };

        document.addEventListener('click', onClick, { capture: true });
        cleanups.push(() => document.removeEventListener('click', onClick, { capture: true }));
    }

    return () => {
        for (const fn of cleanups) fn();
    };
};

export { initCapture };

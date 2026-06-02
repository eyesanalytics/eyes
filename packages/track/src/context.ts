interface EventContext {
    url: string;
    referrer?: string;
    timezone: string;
    language: string;
}

/** Strip the hash fragment from a URL for privacy. */
const stripHash = (url: string): string => {
    const i = url.indexOf('#');
    return i === -1 ? url : url.slice(0, i);
};

/** Return the referrer only when it is cross-origin. */
const getCrossOriginReferrer = (ref: string): string | undefined => {
    if (!ref) return undefined;
    try {
        return new URL(ref).origin !== location.origin ? ref : undefined;
    } catch {
        return undefined;
    }
};

/** Build a context snapshot for the current page. */
const buildContext = (): EventContext => {
    const url = stripHash(location.href);
    // Only include cross-origin referrers (same-origin navigation is noise)
    const ref = document.referrer;
    const referrer = getCrossOriginReferrer(ref);

    return {
        url,
        referrer,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
    };
};

/** Get a clean URL for the current page (no hash). */
const currentUrl = (): string => stripHash(location.href);

export type { EventContext };
export { buildContext, currentUrl };

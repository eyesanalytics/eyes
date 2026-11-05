const OPT_OUT_KEY = 'eyes_optout';

/** Fragments a site owner opens a page with to exclude this browser, or include it again. */
const IGNORE_HASH = '#eyes-ignore';
const UNIGNORE_HASH = '#eyes-unignore';

// Used when localStorage is unavailable, so the objection holds for this page load at least.
let memory = false;

interface NavigatorWithGpc extends Navigator {
    globalPrivacyControl?: boolean;
}

/**
 * Whether this browser objected to tracking. The flag lives in localStorage, per origin, so it
 * holds across tabs and visits. Storing an objection needs no consent.
 */
const isOptedOut = (): boolean => {
    try {
        return localStorage.getItem(OPT_OUT_KEY) === '1';
    } catch {
        return memory;
    }
};

/** Store or clear the objection. */
const setOptedOut = (optedOut: boolean): void => {
    memory = optedOut;
    try {
        if (optedOut) {
            localStorage.setItem(OPT_OUT_KEY, '1');
        } else {
            localStorage.removeItem(OPT_OUT_KEY);
        }
    } catch {
        // Storage unavailable (e.g. sandboxed iframe)
    }
};

/** The choice the current URL fragment asks for, or null when it asks for none. */
const optOutFromHash = (): 'out' | 'in' | null => {
    if (location.hash === IGNORE_HASH) return 'out';
    if (location.hash === UNIGNORE_HASH) return 'in';

    return null;
};

/** Whether the browser sends a Global Privacy Control signal. */
const hasGlobalPrivacyControl = (): boolean => {
    try {
        return (navigator as NavigatorWithGpc).globalPrivacyControl === true;
    } catch {
        return false;
    }
};

export { hasGlobalPrivacyControl, isOptedOut, optOutFromHash, setOptedOut };

const COOKIE_NAME = 'eyes_id';
const MAX_AGE = 365 * 24 * 60 * 60;

/** Read the `eyes_id` cookie value, or null if not set. */
const getEyesId = (): string | null => {
    try {
        const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
        return match?.[1] ? decodeURIComponent(match[1]) : null;
    } catch {
        return null;
    }
};

/** Set the `eyes_id` first-party cookie (1 year, Secure, SameSite=Lax). */
const setEyesId = (id: string, domain?: string): void => {
    try {
        let cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
        if (location.protocol === 'https:') {
            cookie += '; Secure';
        }
        if (domain) {
            cookie += `; domain=${domain}`;
        }
        // biome-ignore lint/suspicious/noDocumentCookie: Standard API for broad browser compatibility
        document.cookie = cookie;
    } catch {
        // Cookie write failed (e.g. sandboxed iframe)
    }
};

/** Remove the `eyes_id` cookie. */
const removeEyesId = (domain?: string): void => {
    try {
        let cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
        if (location.protocol === 'https:') {
            cookie += '; Secure';
        }
        if (domain) {
            cookie += `; domain=${domain}`;
        }
        // biome-ignore lint/suspicious/noDocumentCookie: Standard API for broad browser compatibility
        document.cookie = cookie;
    } catch {
        // Ignore
    }
};

export { getEyesId, removeEyesId, setEyesId };

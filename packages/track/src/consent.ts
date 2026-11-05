import { getEyesId, removeEyesId, setEyesId } from '~/cookie';
import { hasGlobalPrivacyControl, isOptedOut } from '~/opt-out';
import { generateId } from '~/utils/generate-id';

type ConsentState = 'pending' | 'granted' | 'revoked';

/**
 * Remembers a withdrawal on sites that don't wait for consent, where no cookie would otherwise
 * mean "set one". It only keeps the cookie away: cookieless tracking goes on.
 */
const REVOKED_KEY = 'eyes_consent_revoked';

const isRevoked = (): boolean => {
    try {
        return localStorage.getItem(REVOKED_KEY) === '1';
    } catch {
        return false;
    }
};

const setRevoked = (revoked: boolean): void => {
    try {
        if (revoked) {
            localStorage.setItem(REVOKED_KEY, '1');
        } else {
            localStorage.removeItem(REVOKED_KEY);
        }
    } catch {
        // Storage unavailable (e.g. sandboxed iframe)
    }
};

interface ConsentManager {
    /** Current consent state. */
    state(): ConsentState;
    /** Grant consent: generates or reuses eyes_id cookie. */
    grant(): void;
    /** Revoke consent: removes eyes_id cookie. */
    revoke(): void;
    /** Get the current eyes_id (null if consent not granted). */
    eyesId(): string | null;
}

const createConsentManager = (consentRequired: boolean, cookieDomain?: string): ConsentManager => {
    let current: ConsentState = consentRequired ? 'pending' : 'granted';

    // A stored withdrawal keeps the cookie from being set again on the next page load
    if (!consentRequired && isRevoked()) {
        current = 'revoked';
        removeEyesId(cookieDomain);
    }

    // Global Privacy Control objects to the automatic cookie and to identify. Only an explicit
    // consent() grants on such a page, so the state waits like on a site that requires consent.
    if (!consentRequired && current === 'granted' && hasGlobalPrivacyControl()) {
        current = 'pending';
        removeEyesId(cookieDomain);
    }

    // If consent not required, ensure the cookie exists
    if (current === 'granted' && !isOptedOut() && !getEyesId()) {
        setEyesId(generateId(), cookieDomain);
    }

    // If consent is required but cookie already exists (returning visitor who previously consented)
    if (consentRequired && getEyesId()) {
        current = 'granted';
    }

    const grant = (): void => {
        if (current === 'granted') return;
        current = 'granted';
        if (!consentRequired) setRevoked(false);
        const existing = getEyesId();
        if (!existing) {
            setEyesId(generateId(), cookieDomain);
        }
    };

    const revoke = (): void => {
        current = 'revoked';
        if (!consentRequired) setRevoked(true);
        removeEyesId(cookieDomain);
    };

    const eyesId = (): string | null => {
        if (current !== 'granted') return null;
        return getEyesId();
    };

    return {
        state: () => current,
        grant,
        revoke,
        eyesId,
    };
};

export type { ConsentManager, ConsentState };
export { createConsentManager };

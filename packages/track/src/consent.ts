import { getEyesId, removeEyesId, setEyesId } from '~/cookie';
import { generateId } from '~/utils/generate-id';

type ConsentState = 'pending' | 'granted' | 'revoked';

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

    // If consent not required, ensure the cookie exists
    if (!consentRequired) {
        const existing = getEyesId();
        if (!existing) {
            setEyesId(generateId(), cookieDomain);
        }
    }

    // If consent is required but cookie already exists (returning visitor who previously consented)
    if (consentRequired && getEyesId()) {
        current = 'granted';
    }

    const grant = (): void => {
        if (current === 'granted') return;
        current = 'granted';
        const existing = getEyesId();
        if (!existing) {
            setEyesId(generateId(), cookieDomain);
        }
    };

    const revoke = (): void => {
        current = 'revoked';
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

import { generateId } from '~/utils/generate-id';

const SESSION_KEY = 'eyes_sid';

/** Get the current session ID, creating one if it doesn't exist. */
const getSessionId = (): string => {
    try {
        let id = sessionStorage.getItem(SESSION_KEY);
        if (!id) {
            id = generateId();
            sessionStorage.setItem(SESSION_KEY, id);
        }
        return id;
    } catch {
        // sessionStorage unavailable (e.g. private browsing in some browsers)
        return generateId();
    }
};

/** Clear and regenerate the session ID. */
const resetSession = (): string => {
    try {
        sessionStorage.removeItem(SESSION_KEY);
    } catch {
        // Ignore, we'll generate a fresh ID regardless
    }
    return getSessionId();
};

export { getSessionId, resetSession };

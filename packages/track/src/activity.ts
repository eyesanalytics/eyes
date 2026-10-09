import { touchSession } from '~/session';
import { throttle } from '~/utils/throttle';

/**
 * Count visitor input as session activity, so a visitor who keeps reading or scrolling stays in
 * one session while a tab left idle for 30 minutes starts a new one on its next interaction.
 * Returns a cleanup function.
 */
const initActivity = (): (() => void) => {
    const onActivity = throttle(() => touchSession(), 1000);
    const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') onActivity();
    };

    const inputs = ['pointerdown', 'keydown', 'scroll'] as const;
    for (const type of inputs) window.addEventListener(type, onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
        for (const type of inputs) window.removeEventListener(type, onActivity);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    };
};

export { initActivity };

type Eyes = NonNullable<Window['Eyes']>;

// Calls made before the tracker script has loaded, e.g. from a page's mount effect: React runs
// child effects before the provider's, so those fire before the script tag even exists. Capped,
// so a page where the script never loads (ad blocker) does not grow it forever.
const MAX_QUEUED = 100;
const queue: ((eyes: Eyes) => void)[] = [];

/** Replay queued calls on the loaded tracker, oldest first. */
export const drainQueue = (): void => {
    const eyes = window.Eyes;
    if (!eyes) return;

    for (const call of queue.splice(0)) call(eyes);
};

/** Run a call on the tracker, or queue it until the script has loaded. */
export const callEyes = (call: (eyes: Eyes) => void): void => {
    if (typeof window === 'undefined') return;

    if (window.Eyes) {
        drainQueue();
        call(window.Eyes);
        return;
    }

    if (queue.length < MAX_QUEUED) queue.push(call);
};

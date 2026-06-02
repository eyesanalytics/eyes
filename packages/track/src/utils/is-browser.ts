/** Check if we're running in a browser environment. */
const isBrowser = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined';

export { isBrowser };

'use client';

import { useContext } from 'react';
import { EyesContext } from '~/context';
import { callEyes } from '~/queue';

/**
 * Default event map: any string name with optional props.
 */
type DefaultEventMap = Record<string, Record<string, string | number | boolean> | undefined>;

/**
 * Typed track function constrained by an event map.
 */
export type TypedTrack<TEvents extends DefaultEventMap> = <K extends keyof TEvents & string>(
    ...args: TEvents[K] extends undefined
        ? [name: K]
        : undefined extends TEvents[K]
          ? [name: K, props?: TEvents[K]]
          : [name: K, props: TEvents[K]]
) => void;

export interface TypedEyesContextValue<TEvents extends DefaultEventMap> {
    /** Track a typed custom event. */
    track: TypedTrack<TEvents>;
    /** Track a pageview. */
    page(props?: Record<string, string | number | boolean>): void;
    /** Flush all queued events to the server. */
    flush(): Promise<void>;
    /** Stop tracking, flush remaining events, tear down. */
    shutdown(): Promise<void>;
}

export interface TypedEyes<TEvents extends DefaultEventMap> {
    /** Type-safe hook for accessing the Eyes tracker. */
    useEyes: () => TypedEyesContextValue<TEvents>;
    /** Type-safe standalone track function. */
    track: TypedTrack<TEvents>;
}

/**
 * Create a typed Eyes hook and standalone `track` function.
 * Define your event map in a central file for full type safety.
 *
 * @example
 * ```ts
 * // lib/eyes.ts
 * import { createEyes } from 'eyes-react';
 *
 * type Events = {
 *   'Signup Completed': { plan: 'pro' | 'free' };
 *   'Button Clicked': { id: string };
 *   'Page Viewed': undefined; // no props required
 * };
 *
 * export const { useEyes, track } = createEyes<Events>();
 * ```
 *
 * ```tsx
 * // components/button.tsx
 * import { track } from '~/lib/eyes';
 *
 * track('Signup Completed', { plan: 'pro' }); // ✓ type-safe
 * track('Signup Completed', { plan: 'invalid' }); // ✗ type error
 * track('Unknown Event'); // ✗ type error
 * ```
 */
export const createEyes = <
    TEvents extends DefaultEventMap = DefaultEventMap,
>(): TypedEyes<TEvents> => {
    /**
     * Type-safe hook for accessing the Eyes tracker.
     */
    const useEyes = (): TypedEyesContextValue<TEvents> => {
        const ctx = useContext(EyesContext);
        return ctx as unknown as TypedEyesContextValue<TEvents>;
    };

    /**
     * Type-safe standalone track function.
     * Calls the global `window.Eyes.track()`, or queues the call until the script has loaded;
     * works without the hook.
     */
    const track: TypedTrack<TEvents> = (
        name: string,
        props?: Record<string, string | number | boolean>,
    ) => {
        callEyes(eyes => eyes.track(name, props));
    };

    return { useEyes, track };
};

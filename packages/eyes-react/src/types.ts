import type { BeforeSendHook, EyesConfig } from 'eyes-types';

/** Options passed to `EyesProvider` / `EyesNextProvider` (script-tag integration). */
export interface EyesProviderProps {
    /** Public site tracking ID (9-digit numeric string). */
    siteId: string;

    /**
     * Ingress endpoint URL or same-origin proxy path. You almost never need to set this.
     * Override for self-hosting or if you really need to proxy to a different origin.
     * @default "https://ingress.eyes.dev"
     */
    endpoint?: string;

    /**
     * URL to load the tracker script from.
     * @default "https://cdn.eyes.dev/v1/eyes.js"
     */
    scriptUrl?: string;

    /** Automatically track pageviews on init and SPA navigation. @default true */
    autoPageview?: boolean;

    /** Automatically track outbound link clicks. @default true */
    autoOutbound?: boolean;

    /** Use hash-based routing for SPA navigation detection. @default false */
    hashRouting?: boolean;

    /** Enable console debug logging. @default false */
    debug?: boolean;

    /**
     * Whether consent is required before setting persistent identifiers.
     * @default true
     */
    consentRequired?: boolean;

    /** Middleware to inspect/modify/drop events before they are queued. */
    beforeSend?: BeforeSendHook;

    children: React.ReactNode;
}

/** Subset of {@link EyesConfig} wired through the React provider. */
export type EyesProviderConfig = Pick<
    EyesConfig,
    | 'endpoint'
    | 'siteId'
    | 'autoPageview'
    | 'autoOutbound'
    | 'hashRouting'
    | 'debug'
    | 'consentRequired'
    | 'beforeSend'
>;

export interface EyesContextValue {
    /** Track a named custom event. */
    track(name: string, props?: Record<string, string | number | boolean>): void;
    /** Track a pageview. */
    page(props?: Record<string, string | number | boolean>): void;
    /** Opt this browser out: nothing is sent until optIn(). */
    optOut(): void;
    /** Opt this browser back in. Tracking resumes cookieless: the cookie needs consent() again. */
    optIn(): void;
    /** Flush all queued events to the server. */
    flush(): Promise<void>;
    /** Stop tracking, flush remaining events, tear down. */
    shutdown(): Promise<void>;
}

/** Primitive value types allowed in event properties. */
export type PropValue = string | number | boolean;

/** Arbitrary key-value properties attached to events. */
export type Props = Record<string, PropValue>;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export type EventType =
    | 'pageview'
    | 'event'
    | 'engagement'
    | 'vitals'
    | 'identify'
    | 'consent_revoked';

/** Common fields shared by all event types. */
interface BaseEvent {
    url: string;
    sessionId: string;
    timestamp: number;
    eyesId?: string;
}

export interface PageviewEvent extends BaseEvent {
    type: 'pageview';
    referrer?: string;
    props?: Props;
}

export interface CustomEvent extends BaseEvent {
    type: 'event';
    name: string;
    referrer?: string;
    props?: Props;
}

export interface EngagementEvent extends BaseEvent {
    type: 'engagement';
    scrollDepth?: number;
    activeTime?: number;
}

export interface VitalsEvent extends BaseEvent {
    type: 'vitals';
    metric: {
        name: string;
        value: number;
        rating: 'good' | 'needs-improvement' | 'poor';
    };
}

export interface IdentifyEvent extends BaseEvent {
    type: 'identify';
    traits: IdentifyTraits;
}

export interface ConsentRevokedEvent extends BaseEvent {
    type: 'consent_revoked';
}

/** Discriminated union of all event types sent by the tracker. */
export type EyesEvent =
    | PageviewEvent
    | CustomEvent
    | EngagementEvent
    | VitalsEvent
    | IdentifyEvent
    | ConsentRevokedEvent;

/** Traits passed to `identify()`. `id` is the external user ID (required). */
export interface IdentifyTraits {
    /** External user ID from your application (required). */
    id: string;
    email?: string;
    name?: string;
    avatar?: string;
    [key: string]: PropValue | undefined;
}

/**
 * Middleware to inspect or modify events before they are queued.
 * Return the event to allow it, or `null` to drop it.
 */
export type BeforeSendHook = (event: EyesEvent) => EyesEvent | null;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export interface EyesConfig {
    /** Public site tracking ID (9-digit numeric string). Only required field. */
    siteId: string;

    /**
     * Ingress base URL. You almost never need to set this.
     * Override only for self-hosting or if you really need to proxy to a different origin.
     * @default "https://ingress.eyes.dev"
     */
    endpoint?: string;

    /** Enable console debug logging. */
    debug?: boolean;

    /**
     * Whether consent is required before setting persistent identifiers.
     * - `true` (default): No cookies until `consent()` is called. Events are anonymous.
     * - `false`: Consent not required. `eyes_id` cookie set immediately on init.
     * @default true
     */
    consentRequired?: boolean;

    /** Cookie domain for `eyes_id` (e.g. `.example.com` for cross-subdomain). */
    cookieDomain?: string;

    /** Automatically track pageviews on init and SPA navigation. @default true */
    autoPageview?: boolean;

    /** Automatically track outbound link clicks. @default true */
    autoOutbound?: boolean;

    /** Use hash-based routing for SPA navigation detection. @default false */
    hashRouting?: boolean;

    /** Interval in ms between automatic queue flushes. @default 5000 */
    flushInterval?: number;

    /** Max events in queue before an automatic flush is triggered. @default 10 */
    maxBatchSize?: number;

    /** Middleware to inspect/modify/drop events before they are queued. */
    beforeSend?: BeforeSendHook;
}

/** Internal resolved config — all optional fields filled with defaults. */
export interface ResolvedConfig {
    endpoint: string;
    siteId: string;
    debug: boolean;
    consentRequired: boolean;
    cookieDomain?: string;
    autoPageview: boolean;
    autoOutbound: boolean;
    hashRouting: boolean;
    flushInterval: number;
    maxBatchSize: number;
    beforeSend: BeforeSendHook;
}

// ---------------------------------------------------------------------------
// Public API surface returned by init()
// ---------------------------------------------------------------------------
export interface EyesContract {
    /** Track a named custom event. */
    track(name: string, props?: Props): void;
    /** Track a pageview. */
    page(props?: Props): void;
    /** Grant consent — sets persistent eyes_id cookie, enables cross-session tracking. */
    consent(): void;
    /** Revoke consent — removes eyes_id cookie, reverts to anonymous tracking. */
    revokeConsent(): void;
    /** Identify the current visitor with user traits. Requires consent. */
    identify(traits: IdentifyTraits): void;
    /** Flush all queued events to the server. */
    flush(): Promise<void>;
    /** Stop tracking, flush remaining events, tear down plugins. */
    shutdown(): Promise<void>;
}

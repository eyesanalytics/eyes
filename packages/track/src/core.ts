import type { EyesConfig, EyesEvent, IdentifyTraits, Props, ResolvedConfig } from 'eyes-types';
import { initActivity } from '~/activity';
import { initCapture } from '~/capture';
import { resolveConfig } from '~/config';
import { type ConsentManager, createConsentManager } from '~/consent';
import { buildContext, currentUrl } from '~/context';
import { initEngagement } from '~/engagement';
import { isOptedOut, optOutFromHash, setOptedOut } from '~/opt-out';
import { getPageLoadId, getSessionId, touchSession } from '~/session';
import { createTransport, type Transport } from '~/transport';
import { createLogger, type Logger } from '~/utils/logger';
import { initVitals } from '~/vitals';

class EyesTracker {
    readonly config: ResolvedConfig;

    private transport: Transport;
    private logger: Logger;
    private consentManager: ConsentManager;
    private cleanups: Array<() => void> = [];

    constructor(options: EyesConfig) {
        this.config = resolveConfig(options);
        this.logger = createLogger(this.config.debug);
        this.transport = createTransport(this.config, this.logger);

        // A fragment excludes this browser or includes it again, before anything can be sent
        const choice = optOutFromHash();
        if (choice) setOptedOut(choice === 'out');

        this.consentManager = createConsentManager(
            this.config.consentRequired,
            this.config.cookieDomain,
        );

        // Set before the tracker loaded, or on another page: the cookie goes the same way as in optOut()
        if (isOptedOut()) this.revokeConsent();

        this.logger.info('Initialising', {
            siteId: this.config.siteId,
            endpoint: this.config.endpoint,
        });

        // Input keeps the session alive; 30 minutes without it starts a new one
        this.cleanups.push(initActivity());

        // Auto-capture: pageviews + outbound links
        this.cleanups.push(initCapture(this, this.config));

        // Engagement: scroll depth + active time
        this.cleanups.push(initEngagement(this, this.logger));

        // Core Web Vitals
        this.cleanups.push(initVitals(this, this.logger));

        // Start transport auto-flush last: listeners run in registration order, so on pagehide and
        // visibilitychange engagement and vitals enqueue their events before the transport flushes.
        this.transport.start();
    }

    /** Send a named custom event. */
    track = (name: string, props?: Props): void => {
        if (isOptedOut()) return;

        const context = buildContext();
        const event: EyesEvent = {
            type: 'event',
            name,
            url: context.url,
            referrer: context.referrer,
            eyesId: this.consentManager.eyesId() ?? undefined,
            sessionId: touchSession(),
            pageLoadId: getPageLoadId(),
            timestamp: Date.now(),
            props,
        };

        const result = this.config.beforeSend(event);
        if (!result) return;

        this.transport.enqueue(result);
    };

    /** Send a pageview event. */
    page = (props?: Props): void => {
        if (isOptedOut()) return;

        const context = buildContext();
        const event: EyesEvent = {
            type: 'pageview',
            url: context.url,
            referrer: context.referrer,
            eyesId: this.consentManager.eyesId() ?? undefined,
            sessionId: touchSession(),
            pageLoadId: getPageLoadId(),
            timestamp: Date.now(),
            props,
        };

        const result = this.config.beforeSend(event);
        if (!result) return;

        this.transport.enqueue(result);
        // Send pageviews at once: a visitor who leaves within the flush interval would otherwise
        // depend on the unload request, which WebKit drops when the page has not finished loading.
        this.transport.flush();
    };

    /** Grant consent: sets eyes_id cookie, enables cross-session tracking, sends consent_granted. */
    consent = (): void => {
        // An objection outranks consent. A consent banner replaying its choice on every page load
        // must not undo it, so only optIn() does.
        if (isOptedOut()) {
            this.logger.info('consent() dropped: opted out');
            return;
        }

        const changed = this.consentManager.state() !== 'granted';
        this.consentManager.grant();
        const eyesId = this.consentManager.eyesId();

        // Only a change is sent, so the server records when consent was given
        if (changed && eyesId) {
            const event: EyesEvent = {
                type: 'consent_granted',
                url: currentUrl(),
                eyesId,
                sessionId: getSessionId(),
                timestamp: Date.now(),
            };
            const result = this.config.beforeSend(event);
            if (result) this.transport.enqueue(result);
        }

        this.logger.info('Consent granted', { eyesId });
    };

    /** Revoke consent: removes cookie, sends consent_revoked event. */
    revokeConsent = (): void => {
        const eyesId = this.consentManager.eyesId();

        // Send revocation event before clearing the ID
        if (eyesId) {
            const event: EyesEvent = {
                type: 'consent_revoked',
                url: currentUrl(),
                eyesId,
                sessionId: getSessionId(),
                pageLoadId: getPageLoadId(),
                timestamp: Date.now(),
            };
            const result = this.config.beforeSend(event);
            if (result) this.transport.enqueue(result);
        }

        this.consentManager.revoke();
        this.logger.info('Consent revoked');
    };

    /**
     * Opt this browser out: nothing is sent from now on. A visitor with an eyes_id goes through
     * revokeConsent() first, so the server still gets the one event that erases their identity.
     */
    optOut = (): void => {
        this.transport.clear();
        this.revokeConsent();
        setOptedOut(true);
        this.transport.flush();
        this.logger.info('Opted out');
    };

    /** Opt this browser back in. Tracking resumes cookieless: the cookie needs consent() again. */
    optIn = (): void => {
        setOptedOut(false);
        this.logger.info('Opted in');
    };

    /** Identify the current visitor. Requires consent to be granted. */
    identify = (traits: IdentifyTraits): void => {
        if (isOptedOut()) return;

        if (this.consentManager.state() !== 'granted') {
            this.logger.info('identify() dropped: consent not granted');
            return;
        }

        const eyesId = this.consentManager.eyesId();
        if (!eyesId) {
            this.logger.info('identify() dropped: no eyes_id');
            return;
        }

        const event: EyesEvent = {
            type: 'identify',
            url: currentUrl(),
            eyesId,
            sessionId: touchSession(),
            pageLoadId: getPageLoadId(),
            timestamp: Date.now(),
            traits,
        };

        const result = this.config.beforeSend(event);
        if (!result) return;

        this.transport.enqueue(result);
        this.logger.info('Identified', { eyesId, externalId: traits.id });
    };

    /** Enqueue a pre-built event (used by internal modules). */
    send = (event: EyesEvent): void => {
        if (isOptedOut()) return;

        // Attach eyesId to internally-generated events
        const enriched: EyesEvent = {
            ...event,
            eyesId: event.eyesId ?? this.consentManager.eyesId() ?? undefined,
        };
        const result = this.config.beforeSend(enriched);
        if (result) this.transport.enqueue(result);
    };

    /** Flush all queued events to the server. */
    flush = async (): Promise<void> => {
        await this.transport.flush();
    };

    /** Shut down the tracker, flush remaining events, tear down everything. */
    shutdown = async (): Promise<void> => {
        for (const cleanup of this.cleanups) cleanup();
        this.cleanups = [];
        this.transport.stop();
        await this.transport.flush();
        this.logger.info('Shut down');
    };

    /** Get the current page URL (used by engagement/vitals). */
    currentUrl = (): string => currentUrl();
}

export { EyesTracker };

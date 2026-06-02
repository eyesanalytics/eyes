import type { EyesConfig, EyesEvent, IdentifyTraits, Props, ResolvedConfig } from '@eyes/types';
import { initCapture } from '~/capture';
import { resolveConfig } from '~/config';
import { type ConsentManager, createConsentManager } from '~/consent';
import { buildContext, currentUrl } from '~/context';
import { initEngagement } from '~/engagement';
import { getSessionId } from '~/session';
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
        this.consentManager = createConsentManager(
            this.config.consentRequired,
            this.config.cookieDomain,
        );

        this.logger.info('Initialising', { endpoint: this.config.endpoint });

        // Start transport auto-flush
        this.transport.start();

        // Auto-capture: pageviews + outbound links
        this.cleanups.push(initCapture(this, this.config));

        // Engagement: scroll depth + active time
        this.cleanups.push(initEngagement(this, this.logger));

        // Core Web Vitals
        this.cleanups.push(initVitals(this, this.logger));
    }

    /** Send a named custom event. */
    track = (name: string, props?: Props): void => {
        const context = buildContext();
        const event: EyesEvent = {
            type: 'event',
            name,
            url: context.url,
            referrer: context.referrer,
            eyesId: this.consentManager.eyesId() ?? undefined,
            sessionId: getSessionId(),
            timestamp: Date.now(),
            props,
        };

        const result = this.config.beforeSend(event);
        if (!result) return;

        this.transport.enqueue(result);
    };

    /** Send a pageview event. */
    page = (props?: Props): void => {
        const context = buildContext();
        const event: EyesEvent = {
            type: 'pageview',
            url: context.url,
            referrer: context.referrer,
            eyesId: this.consentManager.eyesId() ?? undefined,
            sessionId: getSessionId(),
            timestamp: Date.now(),
            props,
        };

        const result = this.config.beforeSend(event);
        if (!result) return;

        this.transport.enqueue(result);
    };

    /** Grant consent — sets eyes_id cookie, enables cross-session tracking. */
    consent = (): void => {
        this.consentManager.grant();
        this.logger.info('Consent granted', { eyesId: this.consentManager.eyesId() });
    };

    /** Revoke consent — removes cookie, sends consent_revoked event. */
    revokeConsent = (): void => {
        const eyesId = this.consentManager.eyesId();

        // Send revocation event before clearing the ID
        if (eyesId) {
            const event: EyesEvent = {
                type: 'consent_revoked',
                url: currentUrl(),
                eyesId,
                sessionId: getSessionId(),
                timestamp: Date.now(),
            };
            const result = this.config.beforeSend(event);
            if (result) this.transport.enqueue(result);
        }

        this.consentManager.revoke();
        this.logger.info('Consent revoked');
    };

    /** Identify the current visitor. Requires consent to be granted. */
    identify = (traits: IdentifyTraits): void => {
        if (this.consentManager.state() !== 'granted') {
            this.logger.info('identify() dropped — consent not granted');
            return;
        }

        const eyesId = this.consentManager.eyesId();
        if (!eyesId) {
            this.logger.info('identify() dropped — no eyes_id');
            return;
        }

        const event: EyesEvent = {
            type: 'identify',
            url: currentUrl(),
            eyesId,
            sessionId: getSessionId(),
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

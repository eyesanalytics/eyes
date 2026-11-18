import type { EyesConfig, EyesEvent, IdentifyTraits, Props, ResolvedConfig } from 'eyes-types';
import { initActivity } from '~/activity';
import { initCapture } from '~/capture';
import { resolveConfig } from '~/config';
import { type ConsentManager, createConsentManager } from '~/consent';
import { buildContext, currentUrl } from '~/context';
import { initEngagement } from '~/engagement';
import { isOptedOut, optOutFromHash, setOptedOut } from '~/opt-out';
import { getPageLoadId, getSessionId, leaveVisit, touchSession } from '~/session';
import { createTransport, type Transport } from '~/transport';
import { cleanProps } from '~/utils/clean-props';
import { createLogger, type Logger } from '~/utils/logger';
import { initVitals } from '~/vitals';

class EyesTracker {
    readonly config: ResolvedConfig;

    private transport: Transport;
    private logger: Logger;
    private consentManager: ConsentManager;
    private cleanups: Array<() => void> = [];
    private hadEyesId = false;

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

    /**
     * The eyes_id for an event, read before the event takes its session and page load id.
     * Engagement, vitals and consent() read it too. Once the id has gone since the last event,
     * because consent was withdrawn in another tab, the page leaves its visit first: that visit
     * holds the visitor's identity, and cookieless events with its ids would put it back within
     * reach of others on the same address. Nothing still pending can be filed on it then, for the
     * same reason.
     */
    eventEyesId = (): string | undefined => {
        const eyesId = this.consentManager.eyesId();
        if (this.hadEyesId && !eyesId) leaveVisit(false);
        this.hadEyesId = eyesId !== null;

        return eyesId ?? undefined;
    };

    /** Send a named custom event. */
    track = (name: string, props?: Props): void => {
        if (isOptedOut()) return;

        const context = buildContext();
        const event: EyesEvent = {
            type: 'event',
            name,
            url: context.url,
            referrer: context.referrer,
            eyesId: this.eventEyesId(),
            sessionId: touchSession(),
            pageLoadId: getPageLoadId(),
            timestamp: Date.now(),
            props: cleanProps(props, this.logger),
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
            eyesId: this.eventEyesId(),
            sessionId: touchSession(),
            pageLoadId: getPageLoadId(),
            timestamp: Date.now(),
            props: cleanProps(props, this.logger),
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

        // Read first: when a withdrawal in another tab took the eyes_id, the page leaves the visit
        // that held it before consent is given again. A granted state without its cookie is no
        // consent, so this is a change: a new eyes_id is set and announced on the new visit.
        const changed = this.eventEyesId() === undefined;
        this.consentManager.grant();
        const eyesId = this.consentManager.eyesId();
        this.hadEyesId = eyesId !== null;

        // Only a change is sent, so the server records when consent was given
        if (changed && eyesId) {
            const event: EyesEvent = {
                type: 'consent_granted',
                url: currentUrl(),
                eyesId,
                sessionId: getSessionId(),
                pageLoadId: getPageLoadId(),
                timestamp: Date.now(),
            };
            const result = this.config.beforeSend(event);
            if (result) {
                this.transport.enqueue(result);
                // Send it at once: it moves the visit to the eyes_id, where the next page looks.
                this.transport.flush();
            }
        }

        this.logger.info('Consent granted', { eyesId });
    };

    /**
     * Revoke consent: removes the cookie and sends consent_revoked. The page leaves its visit at
     * once, because that visit holds the visitor's identity and the cookieless events to come would
     * put it back within reach of others on the same address.
     */
    revokeConsent = (): void => {
        const eyesId = this.consentManager.eyesId();

        if (eyesId) {
            // The revocation carries the visit's ids, which the server finds the visit by
            const sessionId = getSessionId();
            const pageLoadId = getPageLoadId();

            // The page's engagement and vitals are filed on the visit before the page leaves it
            leaveVisit(true);
            this.hadEyesId = false;

            const event: EyesEvent = {
                type: 'consent_revoked',
                url: currentUrl(),
                eyesId,
                sessionId,
                pageLoadId,
                timestamp: Date.now(),
            };
            const result = this.config.beforeSend(event);
            if (result) this.transport.enqueue(result);
        }

        this.consentManager.revoke();
        this.logger.info('Consent revoked');
    };

    /**
     * Opt this browser out: nothing is sent from now on. A visitor with an eyes_id still goes
     * through revokeConsent(), so the server gets the one event that erases their identity. The
     * opt-out comes first, so the engagement and vitals it files on the visit are dropped.
     */
    optOut = (): void => {
        this.transport.clear();
        setOptedOut(true);
        this.revokeConsent();
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

    /**
     * Enqueue a pre-built event (used by internal modules). They take its eyes_id from
     * eventEyesId() before its session and page load id, like the active events do.
     */
    send = (event: EyesEvent): void => {
        if (isOptedOut()) return;

        const result = this.config.beforeSend(event);
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

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The queue is module state, so we reset modules and re-import per test.

const SITE_ID = '482910300';
const SCRIPT_URL = 'https://cdn.eyes.dev/v1/eyes.js';

const fakeEyes = () => ({
    init: vi.fn(),
    track: vi.fn(),
    page: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    consent: vi.fn(),
    revokeConsent: vi.fn(),
    optOut: vi.fn(),
    optIn: vi.fn(),
    identify: vi.fn(),
});

const findScript = (): HTMLScriptElement | null =>
    document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);

describe('EyesProvider', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.resetModules();
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.head.innerHTML = '';
        delete window.Eyes;
    });

    const importModule = () => import('~/index');

    it('sends a track() from a mount effect once the script has loaded', async () => {
        const { createEyes, EyesProvider } = await importModule();
        const { track } = createEyes();

        // biome-ignore lint/correctness/noComponentHookFactories: the module is re-imported per test, so the component closes over it
        const ThankYouPage = () => {
            useEffect(() => {
                track('Signup Completed', { plan: 'pro' });
            }, []);

            return null;
        };

        act(() => {
            root.render(
                <EyesProvider siteId={SITE_ID}>
                    <ThankYouPage />
                </EyesProvider>,
            );
        });

        // The child's effect ran before the provider appended the script tag
        expect(window.Eyes).toBeUndefined();
        const script = findScript();
        expect(script).not.toBeNull();

        const eyes = fakeEyes();
        window.Eyes = eyes;
        script?.dispatchEvent(new Event('load'));

        expect(eyes.init).toHaveBeenCalledWith(expect.objectContaining({ siteId: SITE_ID }));
        expect(eyes.track).toHaveBeenCalledExactlyOnceWith('Signup Completed', { plan: 'pro' });
        expect(eyes.init.mock.invocationCallOrder[0]).toBeLessThan(
            eyes.track.mock.invocationCallOrder[0],
        );
    });

    it('replays useEyes track and page calls in order', async () => {
        const { EyesProvider, useEyes } = await importModule();

        // biome-ignore lint/correctness/noComponentHookFactories: the module is re-imported per test, so the component closes over it
        const Page = () => {
            const { track, page } = useEyes();

            useEffect(() => {
                page({ section: 'thanks' });
                track('Payment Completed');
            }, [page, track]);

            return null;
        };

        act(() => {
            root.render(
                <EyesProvider siteId={SITE_ID}>
                    <Page />
                </EyesProvider>,
            );
        });

        const eyes = fakeEyes();
        window.Eyes = eyes;
        findScript()?.dispatchEvent(new Event('load'));

        expect(eyes.page).toHaveBeenCalledExactlyOnceWith({ section: 'thanks' });
        expect(eyes.track).toHaveBeenCalledExactlyOnceWith('Payment Completed', undefined);
        expect(eyes.page.mock.invocationCallOrder[0]).toBeLessThan(
            eyes.track.mock.invocationCallOrder[0],
        );
    });

    it('replays consent before identify, so the identify is not dropped', async () => {
        const { EyesProvider, useEyes } = await importModule();

        // biome-ignore lint/correctness/noComponentHookFactories: the module is re-imported per test, so the component closes over it
        const Page = () => {
            const { consent, identify } = useEyes();

            useEffect(() => {
                consent();
                identify({ id: 'usr_42', email: 'ada@example.com' });
            }, [consent, identify]);

            return null;
        };

        act(() => {
            root.render(
                <EyesProvider siteId={SITE_ID}>
                    <Page />
                </EyesProvider>,
            );
        });

        const eyes = fakeEyes();
        window.Eyes = eyes;
        findScript()?.dispatchEvent(new Event('load'));

        expect(eyes.consent).toHaveBeenCalledOnce();
        expect(eyes.identify).toHaveBeenCalledExactlyOnceWith({
            id: 'usr_42',
            email: 'ada@example.com',
        });
        expect(eyes.init.mock.invocationCallOrder[0]).toBeLessThan(
            eyes.consent.mock.invocationCallOrder[0],
        );
        expect(eyes.consent.mock.invocationCallOrder[0]).toBeLessThan(
            eyes.identify.mock.invocationCallOrder[0],
        );
    });

    it('revokes consent through the hook', async () => {
        const { EyesProvider, useEyes } = await importModule();
        const eyes = fakeEyes();
        window.Eyes = eyes;
        let revoke: () => void = () => {};

        // biome-ignore lint/correctness/noComponentHookFactories: the module is re-imported per test, so the component closes over it
        const Page = () => {
            revoke = useEyes().revokeConsent;

            return null;
        };

        act(() => {
            root.render(
                <EyesProvider siteId={SITE_ID}>
                    <Page />
                </EyesProvider>,
            );
        });
        revoke();

        expect(eyes.revokeConsent).toHaveBeenCalledOnce();
    });

    it('passes cookieDomain to init', async () => {
        const { EyesProvider } = await importModule();
        const eyes = fakeEyes();
        window.Eyes = eyes;

        act(() => {
            root.render(
                <EyesProvider siteId={SITE_ID} cookieDomain=".example.com">
                    {null}
                </EyesProvider>,
            );
        });

        expect(eyes.init).toHaveBeenCalledWith(
            expect.objectContaining({ siteId: SITE_ID, cookieDomain: '.example.com' }),
        );
    });

    it('leaves cookieDomain out of init when it is not set', async () => {
        const { EyesProvider } = await importModule();
        const eyes = fakeEyes();
        window.Eyes = eyes;

        act(() => {
            root.render(<EyesProvider siteId={SITE_ID}>{null}</EyesProvider>);
        });

        expect(eyes.init.mock.calls[0]?.[0]).not.toHaveProperty('cookieDomain');
    });

    it('calls the tracker directly when the script is already loaded', async () => {
        const { createEyes, EyesProvider } = await importModule();
        const { track } = createEyes();
        const eyes = fakeEyes();
        window.Eyes = eyes;

        act(() => {
            root.render(<EyesProvider siteId={SITE_ID}>{null}</EyesProvider>);
        });
        track('Button Clicked', { id: 'cta' });

        expect(eyes.init).toHaveBeenCalledOnce();
        expect(eyes.track).toHaveBeenCalledExactlyOnceWith('Button Clicked', { id: 'cta' });
        expect(findScript()).toBeNull();
    });
});

describe('useEyes without a provider', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.resetModules();
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('returns no-op consent, revokeConsent and identify', async () => {
        const { useEyes } = await import('~/index');

        // biome-ignore lint/correctness/noComponentHookFactories: the module is re-imported per test, so the component closes over it
        const Page = () => {
            const { consent, revokeConsent, identify } = useEyes();

            consent();
            revokeConsent();
            identify({ id: 'usr_42' });

            return null;
        };

        expect(() => act(() => root.render(<Page />))).not.toThrow();
    });
});

describe('createEyes track without a provider', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        delete window.Eyes;
    });

    it('keeps at most 100 calls until the script has loaded', async () => {
        const { createEyes } = await import('~/index');
        const { track } = createEyes();

        for (let i = 0; i < 150; i++) track(`Queued ${i}`);

        const eyes = fakeEyes();
        window.Eyes = eyes;
        track('Loaded');

        const names = eyes.track.mock.calls.map(([name]) => name);
        expect(names).toHaveLength(101);
        expect(names[0]).toBe('Queued 0');
        expect(names[99]).toBe('Queued 99');
        expect(names[100]).toBe('Loaded');
    });
});

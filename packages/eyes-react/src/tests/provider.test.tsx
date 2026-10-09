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

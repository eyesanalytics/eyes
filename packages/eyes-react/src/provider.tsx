'use client';

import type { EyesConfig } from 'eyes-types';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { EyesContext } from '~/context';
import type { EyesContextValue, EyesProviderProps } from '~/types';

const DEFAULT_INGRESS_URL = 'https://ingress.eyes.dev';
const DEFAULT_SCRIPT_URL = 'https://cdn.eyes.dev/v1/eyes.js';
export const EyesProvider = ({
    endpoint = DEFAULT_INGRESS_URL,
    siteId,
    scriptUrl = DEFAULT_SCRIPT_URL,
    autoPageview,
    autoOutbound,
    hashRouting,
    debug,
    consentRequired,
    beforeSend,
    children,
}: EyesProviderProps) => {
    const initCalled = useRef(false);
    const configRef = useRef<EyesConfig>({ siteId });

    if (endpoint !== undefined) configRef.current.endpoint = endpoint;
    if (autoPageview !== undefined) configRef.current.autoPageview = autoPageview;
    if (autoOutbound !== undefined) configRef.current.autoOutbound = autoOutbound;
    if (hashRouting !== undefined) configRef.current.hashRouting = hashRouting;
    if (debug !== undefined) configRef.current.debug = debug;
    if (consentRequired !== undefined) configRef.current.consentRequired = consentRequired;
    if (beforeSend !== undefined) configRef.current.beforeSend = beforeSend;

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const initEyes = () => {
            if (!initCalled.current && window.Eyes) {
                initCalled.current = true;
                window.Eyes.init(configRef.current);
            }
        };

        // If the script is already loaded, init immediately
        if (window.Eyes) {
            initEyes();
            return;
        }

        const existing = document.querySelector(`script[src="${scriptUrl}"]`);
        if (existing) {
            existing.addEventListener('load', initEyes);
            return () => existing.removeEventListener('load', initEyes);
        }

        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.addEventListener('load', initEyes);
        document.head.appendChild(script);

        return () => {
            script.removeEventListener('load', initEyes);
        };
    }, [scriptUrl]);

    const track: EyesContextValue['track'] = useCallback((name, props) => {
        window.Eyes?.track(name, props);
    }, []);

    const page: EyesContextValue['page'] = useCallback(props => {
        window.Eyes?.page(props);
    }, []);

    const flush: EyesContextValue['flush'] = useCallback(async () => {
        await window.Eyes?.flush();
    }, []);

    const shutdown: EyesContextValue['shutdown'] = useCallback(async () => {
        await window.Eyes?.shutdown();
    }, []);

    const value = useMemo<EyesContextValue>(
        () => ({ track, page, flush, shutdown }),
        [track, page, flush, shutdown],
    );

    return <EyesContext.Provider value={value}>{children}</EyesContext.Provider>;
};

'use client';

import { type Context, createContext } from 'react';
import type { EyesContextValue } from '~/types';

const noop = () => {};
const asyncNoop = () => Promise.resolve();

export const EyesContext: Context<EyesContextValue> = createContext<EyesContextValue>({
    track: noop,
    page: noop,
    consent: noop,
    revokeConsent: noop,
    identify: noop,
    optOut: noop,
    optIn: noop,
    flush: asyncNoop,
    shutdown: asyncNoop,
});

'use client';

import { type Context, createContext } from 'react';
import type { EyesContextValue } from '~/types';

const noop = () => {};
const asyncNoop = () => Promise.resolve();

export const EyesContext: Context<EyesContextValue> = createContext<EyesContextValue>({
    track: noop,
    page: noop,
    flush: asyncNoop,
    shutdown: asyncNoop,
});

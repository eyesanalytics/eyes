'use client';

import { createContext } from 'react';
import type { EyesContextValue } from '~/types';

const noop = () => {};
const asyncNoop = () => Promise.resolve();

export const EyesContext = createContext<EyesContextValue>({
    track: noop,
    page: noop,
    flush: asyncNoop,
    shutdown: asyncNoop,
});

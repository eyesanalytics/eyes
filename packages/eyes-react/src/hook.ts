'use client';

import { useContext } from 'react';
import { EyesContext } from '~/context';
import type { EyesContextValue } from '~/types';

/**
 * Access the Eyes tracker instance.
 * Returns no-op functions when used outside an EyesProvider.
 */
export const useEyes = (): EyesContextValue => {
    return useContext(EyesContext);
};

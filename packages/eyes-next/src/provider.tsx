'use client';

import type { EyesProviderProps } from 'eyes-react';
import { EyesProvider } from 'eyes-react';
import type { ReactElement } from 'react';

export interface EyesNextProviderProps extends Omit<EyesProviderProps, 'endpoint' | 'scriptUrl'> {
    /**
     * Proxy base path configured via `withEyes`.
     * @default "/api/eyes"
     */
    basePath?: string;

    /** Override the endpoint URL (defaults to `{basePath}` for proxying). */
    endpoint?: string;

    /** Override the script URL (defaults to `{basePath}/eyes.js` for proxying). */
    scriptUrl?: string;
}

/**
 * Pre-configured Eyes provider for Next.js apps using the proxy setup.
 * Defaults `endpoint` and `scriptUrl` to the proxy paths set by `withEyes`.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { EyesNextProvider } from 'eyes-next';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <EyesNextProvider>{children}</EyesNextProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export const EyesNextProvider = ({
    basePath = '/api/eyes',
    endpoint,
    scriptUrl,
    ...props
}: EyesNextProviderProps): ReactElement => {
    const base = basePath.replace(/\/+$/, '');

    return (
        <EyesProvider
            endpoint={endpoint ?? base}
            scriptUrl={scriptUrl ?? `${base}/eyes.js`}
            {...props}
        />
    );
};

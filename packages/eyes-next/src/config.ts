export interface EyesNextOptions {
    /** The ingress URL where events are forwarded to (e.g. "https://ingress.eyes.dev"). */
    ingressUrl: string;

    /**
     * URL of the tracker script.
     * @default "https://cdn.eyes.dev/v1/eyes.js"
     */
    scriptUrl?: string;

    /**
     * Local proxy base path.
     * @default "/api/eyes"
     */
    basePath?: string;
}

const DEFAULT_BASE_PATH = '/api/eyes';

/**
 * Wrap your Next.js config to enable automatic proxying for Eyes Analytics.
 *
 * This adds rewrites so that:
 * - `{basePath}/eyes.js` → CDN-hosted tracker script
 * - `{basePath}/v1/:path*` → your ingress URL
 *
 * This keeps all analytics traffic on the same origin, avoiding ad blockers.
 *
 * @example
 * ```ts
 * // next.config.ts
 * import { withEyes } from 'eyes-next';
 *
 * export default withEyes(nextConfig, {
 *   ingressUrl: 'https://ingress.eyes.dev',
 * });
 * ```
 */
export const withEyes = <NextConfig>(
    nextConfig: NextConfig,
    options: EyesNextOptions,
): NextConfig => {
    const { ingressUrl, basePath = DEFAULT_BASE_PATH } = options;

    // Normalize: strip trailing slashes
    const base = basePath.replace(/\/+$/, '');
    const ingress = ingressUrl.replace(/\/+$/, '');
    const scriptUrl = options.scriptUrl ?? 'https://cdn.eyes.dev/v1/eyes.js';

    const eyesRewrites = [
        {
            source: `${base}/eyes.js`,
            destination: scriptUrl,
        },
        {
            source: `${base}/v1/:path*`,
            destination: `${ingress}/v1/:path*`,
        },
    ];

    return {
        ...nextConfig,
        rewrites: async () => {
            // @ts-expect-error
            const existing = await nextConfig.rewrites?.();

            // Next.js rewrites can be an array or an object with beforeFiles/afterFiles/fallback
            if (Array.isArray(existing)) {
                return [...existing, ...eyesRewrites];
            }

            if (existing) {
                return {
                    ...existing,
                    afterFiles: [...(existing.afterFiles || []), ...eyesRewrites],
                };
            }

            return eyesRewrites;
        },
    };
};

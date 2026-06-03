const DEFAULT_INGRESS_URL = 'https://ingress.eyes.dev';

/** Ingress rewrite target — override with `EYES_INGRESS_URL` for local dev (e.g. `http://127.0.0.1:3002`). */
const resolveIngressUrl = (): string => {
    const envUrl = process.env.EYES_INGRESS_URL?.trim();
    const url = envUrl ? envUrl : DEFAULT_INGRESS_URL;
    return url.replace(/\/+$/, '');
};

export interface EyesNextOptions {
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
 * - `{basePath}/v1/:path*` → `https://ingress.eyes.dev` (or `EYES_INGRESS_URL` when set)
 *
 * This keeps all analytics traffic on the same origin, avoiding ad blockers.
 *
 * @example
 * ```ts
 * // next.config.ts
 * import { withEyes } from 'eyes-next';
 *
 * export default withEyes(nextConfig);
 * ```
 */
export const withEyes = <NextConfig>(
    nextConfig: NextConfig,
    options: EyesNextOptions = {},
): NextConfig => {
    const { basePath = DEFAULT_BASE_PATH } = options;

    const base = basePath.replace(/\/+$/, '');
    const scriptUrl = options.scriptUrl ?? 'https://cdn.eyes.dev/v1/eyes.js';
    const ingressUrl = resolveIngressUrl();

    const eyesRewrites = [
        {
            source: `${base}/eyes.js`,
            destination: scriptUrl,
        },
        {
            source: `${base}/v1/:path*`,
            destination: `${ingressUrl}/v1/:path*`,
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

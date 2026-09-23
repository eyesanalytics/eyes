const DEFAULT_INGRESS_URL = 'https://ingress.eyes.dev';

/** Ingress rewrite target; override with `EYES_INGRESS_URL` for local dev (e.g. `http://127.0.0.1:3002`). */
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
 * Query parameter the ingress reads the visitor's address from when events arrive through
 * a customer-side proxy. Must match `VISITOR_IP_PARAM` in `apps/ingress/src/client-ip.ts`.
 */
const VISITOR_IP_PARAM = 'visitor_ip';

/**
 * Request headers a hosting platform stamps with the visitor's address, most trustworthy
 * first. Cloudflare sets `cf-connecting-ip`, Vercel and most reverse proxies set `x-real-ip`,
 * and anything else shows up as the first `x-forwarded-for` entry. A rewrite cannot add
 * headers, so the captured `ip` group travels in the destination query string instead.
 */
const VISITOR_IP_HEADERS = [
    { key: 'cf-connecting-ip', value: '(?<ip>.+)' },
    { key: 'x-real-ip', value: '(?<ip>.+)' },
    { key: 'x-forwarded-for', value: '(?<ip>[^,]+)(?:,.*)?' },
] as const;

/**
 * Wrap your Next.js config to enable automatic proxying for Eyes Analytics.
 *
 * This adds rewrites so that:
 * - `{basePath}/eyes.js` → CDN-hosted tracker script
 * - `{basePath}/v1/:path*` → `https://ingress.eyes.dev` (or `EYES_INGRESS_URL` when set)
 *
 * This keeps all analytics traffic on the same origin, avoiding ad blockers.
 *
 * Proxied requests reach the ingress from your server, not the visitor, and platforms such
 * as Cloudflare Tunnel or Caddy replace `x-forwarded-for` with their own hop. The ingress
 * rewrites therefore forward the visitor's address as seen by your server, so geolocation
 * keeps working behind the proxy.
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
    const ingressSource = `${base}/v1/:path*`;
    const ingressDestination = `${ingressUrl}/v1/:path*`;

    const eyesRewrites = [
        {
            source: `${base}/eyes.js`,
            destination: scriptUrl,
        },
        // Next.js applies the first matching rewrite, so the header order above is the
        // preference order. The plain rewrite catches requests without any of them.
        ...VISITOR_IP_HEADERS.map(header => ({
            source: ingressSource,
            has: [{ type: 'header' as const, key: header.key, value: header.value }],
            destination: `${ingressDestination}?${VISITOR_IP_PARAM}=:ip`,
        })),
        {
            source: ingressSource,
            destination: ingressDestination,
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

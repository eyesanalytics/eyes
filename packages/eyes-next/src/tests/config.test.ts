import { afterEach, describe, expect, it, vi } from 'vitest';

import { withEyes } from '~/config';

interface Rewrite {
    source: string;
    destination: string;
    has?: { type: string; key: string; value: string }[];
}

type RewriteResult =
    | Rewrite[]
    | { beforeFiles?: Rewrite[]; afterFiles?: Rewrite[]; fallback?: Rewrite[] };

interface RewriteConfig {
    rewrites?: () => Promise<RewriteResult>;
}

const resolveRewrites = async (config: RewriteConfig): Promise<RewriteResult> => {
    const rewrites = config.rewrites;
    if (!rewrites) {
        throw new Error('withEyes did not add rewrites');
    }

    return rewrites();
};

const asArray = (result: RewriteResult): Rewrite[] => {
    if (!Array.isArray(result)) {
        throw new Error('expected an array of rewrites');
    }

    return result;
};

describe('withEyes', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('proxies the tracker script and the ingress under the base path', async () => {
        const rewrites = asArray(await resolveRewrites(withEyes<RewriteConfig>({})));

        expect(rewrites[0]).toEqual({
            source: '/api/eyes/eyes.js',
            destination: 'https://cdn.eyes.dev/v1/eyes.js',
        });
        expect(rewrites.at(-1)).toEqual({
            source: '/api/eyes/v1/:path*',
            destination: 'https://ingress.eyes.dev/v1/:path*',
        });
    });

    it('forwards the visitor ip from the platform header, most trustworthy first', async () => {
        const rewrites = asArray(await resolveRewrites(withEyes<RewriteConfig>({})));
        const forwarding = rewrites.filter(rewrite => rewrite.has);

        expect(forwarding.map(rewrite => rewrite.has?.[0]?.key)).toEqual([
            'cf-connecting-ip',
            'x-real-ip',
            'x-forwarded-for',
        ]);

        for (const rewrite of forwarding) {
            expect(rewrite.source).toBe('/api/eyes/v1/:path*');
            expect(rewrite.destination).toBe('https://ingress.eyes.dev/v1/:path*?visitor_ip=:ip');
            expect(rewrite.has).toHaveLength(1);
            expect(rewrite.has?.[0]?.type).toBe('header');
            expect(rewrite.has?.[0]?.value).toContain('(?<ip>');
        }

        // The plain rewrite must come last so requests without any header still reach the ingress.
        expect(rewrites.indexOf(forwarding.at(-1) as Rewrite)).toBe(rewrites.length - 2);
    });

    it('captures only the first x-forwarded-for entry', async () => {
        const rewrites = asArray(await resolveRewrites(withEyes<RewriteConfig>({})));
        const forwardedFor = rewrites.find(rewrite => rewrite.has?.[0]?.key === 'x-forwarded-for');
        const pattern = new RegExp(`^${forwardedFor?.has?.[0]?.value}$`);

        expect('198.51.100.7'.match(pattern)?.groups?.ip).toBe('198.51.100.7');
        expect('198.51.100.7, 10.0.0.1'.match(pattern)?.groups?.ip).toBe('198.51.100.7');
        expect('2001:db8::1,10.0.0.1'.match(pattern)?.groups?.ip).toBe('2001:db8::1');
    });

    it('honours a custom base path, script url and ingress url', async () => {
        vi.stubEnv('EYES_INGRESS_URL', 'http://127.0.0.1:3002/');

        const rewrites = asArray(
            await resolveRewrites(
                withEyes<RewriteConfig>(
                    {},
                    { basePath: '/stats/', scriptUrl: 'https://example.com/eyes.js' },
                ),
            ),
        );

        expect(rewrites[0]).toEqual({
            source: '/stats/eyes.js',
            destination: 'https://example.com/eyes.js',
        });
        expect(rewrites.at(-1)).toEqual({
            source: '/stats/v1/:path*',
            destination: 'http://127.0.0.1:3002/v1/:path*',
        });
        expect(rewrites[1]?.destination).toBe('http://127.0.0.1:3002/v1/:path*?visitor_ip=:ip');
    });

    it('appends to existing array rewrites', async () => {
        const existing = { source: '/old', destination: '/new' };
        const result = await resolveRewrites(
            withEyes<RewriteConfig>({ rewrites: async () => [existing] }),
        );

        expect(asArray(result)[0]).toEqual(existing);
        expect(asArray(result)).toHaveLength(6);
    });

    it('appends to afterFiles when rewrites are grouped', async () => {
        const existing = { source: '/old', destination: '/new' };
        const result = await resolveRewrites(
            withEyes<RewriteConfig>({
                rewrites: async () => ({ beforeFiles: [existing], afterFiles: [existing] }),
            }),
        );

        if (Array.isArray(result)) {
            throw new Error('expected grouped rewrites');
        }

        expect(result.beforeFiles).toEqual([existing]);
        expect(result.afterFiles?.[0]).toEqual(existing);
        expect(result.afterFiles).toHaveLength(6);
    });
});

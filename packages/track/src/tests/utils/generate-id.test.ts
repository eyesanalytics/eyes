import { describe, expect, it } from 'vitest';
import { generateId } from '~/utils/generate-id';

describe('generateId', () => {
    it('returns a valid UUID string', () => {
        const id = generateId();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('uses fallback when crypto.randomUUID is unavailable', () => {
        const original = crypto.randomUUID;
        try {
            // @ts-expect-error, removing for fallback test
            crypto.randomUUID = undefined;
            const id = generateId();
            expect(id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
        } finally {
            crypto.randomUUID = original;
        }
    });
});

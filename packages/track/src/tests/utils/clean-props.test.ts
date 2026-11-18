import type { Props } from 'eyes-types';
import { describe, expect, it, vi } from 'vitest';
import { cleanProps } from '~/utils/clean-props';

const makeLogger = () => ({ info: vi.fn(), event: vi.fn(), warn: vi.fn() });

/** Props as plain JavaScript can pass them, past what the types allow. */
const untyped = (props: Record<string, unknown>): Props => props as Props;

describe('cleanProps', () => {
    it('keeps valid props exactly as they are', () => {
        const props: Props = {
            plan: 'pro',
            empty: '',
            long: 'a'.repeat(1024),
            emoji: '😀'.repeat(512),
            count: 0,
            price: -12.5,
            beta: false,
            ' padded key ': 'kept',
            ['k'.repeat(255)]: true,
        };
        for (let i = 0; i < 41; i++) props[`extra${i}`] = i;
        const logger = makeLogger();

        expect(Object.keys(props)).toHaveLength(50);
        expect(cleanProps(props, logger)).toEqual(props);
        expect(Object.keys(cleanProps(props, logger) ?? {})).toEqual(Object.keys(props));
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('passes no props through', () => {
        expect(cleanProps(undefined, makeLogger())).toBeUndefined();
    });

    it('drops values the ingress does not accept and logs each', () => {
        const logger = makeLogger();
        const props = untyped({
            kept: 'yes',
            list: ['a'],
            nested: { a: 1 },
            missing: null,
            unset: undefined,
            nan: Number.NaN,
            infinite: Number.POSITIVE_INFINITY,
            big: 10n,
            fn: () => {},
        });

        expect(cleanProps(props, logger)).toEqual({ kept: 'yes' });
        expect(logger.warn).toHaveBeenCalledTimes(8);
        expect(logger.warn).toHaveBeenCalledWith('Dropped prop "list": unsupported value', ['a']);
    });

    it('cuts strings to 1,024 characters without splitting a character', () => {
        const logger = makeLogger();
        const cleaned = cleanProps(
            { plain: 'a'.repeat(2000), emoji: `${'a'.repeat(1023)}😀` },
            logger,
        );

        expect(cleaned?.plain).toBe('a'.repeat(1024));
        expect(cleaned?.emoji).toBe('a'.repeat(1023));
        expect(logger.warn).toHaveBeenCalledWith('Cut prop "plain" to 1024 characters');
    });

    it('drops blank keys and keys over 255 characters', () => {
        const logger = makeLogger();
        const cleaned = cleanProps(
            { '': 1, '   ': 2, ['k'.repeat(256)]: 3, [` ${'k'.repeat(255)} `]: 4 },
            logger,
        );

        expect(cleaned).toEqual({ [` ${'k'.repeat(255)} `]: 4 });
        expect(logger.warn).toHaveBeenCalledTimes(3);
    });

    it('keeps at most 50 props, counting only the props it keeps', () => {
        const logger = makeLogger();
        const props: Record<string, unknown> = { dropped: null };
        for (let i = 0; i < 52; i++) props[`p${i}`] = i;

        const cleaned = cleanProps(untyped(props), logger);

        expect(Object.keys(cleaned ?? {})).toHaveLength(50);
        expect(cleaned).not.toHaveProperty('p50');
        expect(logger.warn).toHaveBeenCalledWith('Dropped prop "p51": more than 50 props', 51);
    });
});

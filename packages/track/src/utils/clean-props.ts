import type { Props } from 'eyes-types';
import type { Logger } from '~/utils/logger';

// The limits of the ingress, which refuses a whole event when one of its props is outside them
const MAX_PROPS = 50;
const MAX_KEY_LENGTH = 255;
const MAX_VALUE_LENGTH = 1024;

/**
 * Bring props within the limits of the ingress before the event is queued. A value that is not a
 * string, a finite number or a boolean is dropped, and so is a key that is blank or too long and
 * every prop past the limit; a long string is cut. Valid props stay exactly as they are. Each
 * change is logged in debug mode.
 */
const cleanProps = (props: Props | undefined, logger: Logger): Props | undefined => {
    if (!props) return props;

    const clean: Props = {};
    let count = 0;

    for (const [key, value] of Object.entries(props)) {
        // The ingress trims a key before it measures it
        const keyLength = key.trim().length;
        const problem =
            typeof value !== 'string' && typeof value !== 'boolean' && !Number.isFinite(value)
                ? 'unsupported value'
                : keyLength < 1 || keyLength > MAX_KEY_LENGTH
                  ? `key must be 1 to ${MAX_KEY_LENGTH} characters`
                  : count === MAX_PROPS
                    ? `more than ${MAX_PROPS} props`
                    : '';

        if (problem) {
            logger.warn(`Dropped prop "${key}": ${problem}`, value);
            continue;
        }

        count++;
        clean[key] = value;

        if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
            // One code unit less when the cut would split a character made of two
            const end = Number(value.codePointAt(MAX_VALUE_LENGTH - 1)) > 0xffff ? 1 : 0;
            clean[key] = value.slice(0, MAX_VALUE_LENGTH - end);
            logger.warn(`Cut prop "${key}" to ${MAX_VALUE_LENGTH} characters`);
        }
    }

    return clean;
};

export { cleanProps };

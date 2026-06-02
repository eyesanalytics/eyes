const BADGE_STYLE = [
    'background: #005743',
    'color: #fff',
    'padding: 2px 6px',
    'border-radius: 3px',
    'font-weight: 600',
    'font-size: 11px',
].join(';');

const MESSAGE_STYLE = 'color: #fff; font-weight: 600; font-size: 11px';
const LABEL_STYLE = 'color: #7D807D; font-weight: normal; font-size: 11px';
const VALUE_STYLE = 'color: #fff; font-weight: 500';

interface Logger {
    info(message: string, ...data: unknown[]): void;
    event(type: string, detail?: Record<string, unknown>): void;
    warn(message: string, ...data: unknown[]): void;
}

const noopLogger: Logger = {
    info: () => {},
    event: () => {},
    warn: () => {},
};

const createLogger = (debug: boolean): Logger => {
    if (!debug) return noopLogger;

    return {
        info(message, ...data) {
            console.log(`%c Eyes %c ${message}`, BADGE_STYLE, MESSAGE_STYLE, ...data);
        },
        event(type, detail) {
            console.groupCollapsed(`%c Eyes %c ${type}`, BADGE_STYLE, MESSAGE_STYLE);
            if (detail) {
                for (const [key, value] of Object.entries(detail)) {
                    console.log(
                        `%c${key}: %c${typeof value === 'object' ? '' : String(value)}`,
                        LABEL_STYLE,
                        VALUE_STYLE,
                        typeof value === 'object' ? value : '',
                    );
                }
            }
            console.groupEnd();
        },
        warn(message, ...data) {
            console.warn(`%c Eyes %c ${message}`, BADGE_STYLE, MESSAGE_STYLE, ...data);
        },
    };
};

export type { Logger };
export { createLogger };

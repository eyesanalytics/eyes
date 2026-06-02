/** Standard throttle, calls `fn` at most once per `ms` milliseconds. */
const throttle = <TArgs extends unknown[]>(
    fn: (...args: TArgs) => void,
    ms: number,
): ((...args: TArgs) => void) => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    return (...args: TArgs) => {
        const now = Date.now();
        const remaining = ms - (now - last);

        if (remaining <= 0) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            last = now;
            fn(...args);
            return;
        }

        if (!timer) {
            timer = setTimeout(() => {
                last = Date.now();
                timer = null;
                fn(...args);
            }, remaining);
        }
    };
};

export { throttle };

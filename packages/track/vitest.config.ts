import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '~': src,
        },
    },
    test: {
        environment: 'happy-dom',
        // Node 25 and later define localStorage and sessionStorage on the global object, and the
        // happy-dom environment only replaces globals vitest knows, so the tests would get Node's
        // storage: undefined without --localstorage-file. Turning Node's off lets happy-dom's in.
        // Node 22.4 and later accept the flag; before 25 it is already the default.
        execArgv: ['--no-experimental-webstorage'],
        environmentOptions: {
            happyDOM: {
                settings: {
                    disableJavaScriptFileLoading: true,
                },
            },
        },
        include: ['src/tests/**/*.test.ts'],
    },
});

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

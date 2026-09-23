import { defineConfig } from 'tsdown';

export default defineConfig([
    // ESM + CJS for npm consumers
    {
        entry: ['src/index.ts'],
        format: ['esm', 'cjs'],
        dts: { sourcemap: false },
        sourcemap: false,
        clean: true,
        deps: {
            neverBundle: ['eyes-types'],
        },
    },
    // IIFE for <script> tag usage → window.Eyes (auto-inits from data-site)
    {
        entry: { index: 'src/browser.ts' },
        format: ['iife'],
        globalName: 'Eyes',
        sourcemap: false,
        minify: true,
        outDir: 'dist',
    },
]);

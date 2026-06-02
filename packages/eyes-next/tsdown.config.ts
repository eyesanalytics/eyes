import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/index.ts', 'src/config.ts'],
    format: ['esm', 'cjs'],
    dts: { sourcemap: false },
    sourcemap: false,
    clean: true,
    deps: {
        neverBundle: ['react', 'react/jsx-runtime', 'next', 'eyes-react'],
    },
});

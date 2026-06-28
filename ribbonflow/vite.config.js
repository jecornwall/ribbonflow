import { defineConfig } from 'vite'

// `ribbonflow` library build (spec §6). ESM + CJS. @ribbonflow/core is
// externalised (it is a real dependency, resolved by the consumer) rather than
// inlined. In-repo consumers import SOURCE via the package `exports` default;
// this build produces the publish artefacts + JSDoc-derived .d.ts (tsc).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: { index: 'src/index.js' },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['@ribbonflow/core'],
      output: { entryFileNames: '[name].[format].js' },
    },
  },
})

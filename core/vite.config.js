import { defineConfig } from 'vite'

// @ribbonflow/core library build (spec §6). Pure ESM + CJS, no externals — the
// core has no runtime dependencies (no DOM, no framework). In-repo consumers
// import SOURCE via the package `exports` default; this build produces the
// artefacts the eventual publish uses, alongside JSDoc-derived .d.ts (tsc).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: { index: 'src/index.js' },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      output: { entryFileNames: '[name].[format].js' },
    },
  },
})

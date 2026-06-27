import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Library build (spec §6). All three entries (index, render, internals) ship
// ESM + CJS (`formats: ['es','cjs']`). vue is externalized as a peer — never
// bundled into any entry. In-repo consumers keep importing SOURCE via the
// package `exports`; this build produces the artefacts the eventual
// publish/split uses.
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: {
        index: 'src/index.js',
        render: 'src/render/index.js',
        internals: 'src/internals.js',
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['vue'],
      output: { entryFileNames: '[name].[format].js' },
    },
  },
})

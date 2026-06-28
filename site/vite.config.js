import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// base is /ribbonflow/ in CI (SITE_BASE), / for local dev/preview.
// fs.allow ['..'] lets the dev server read examples/ (a sibling of site/).
// Two HTML entries: the landing page and the full-screen flow viewer.
export default defineConfig({
  base: process.env.SITE_BASE || '/',
  server: { fs: { allow: ['..'] } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)),
      },
    },
  },
})

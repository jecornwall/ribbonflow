import { defineConfig } from 'vite'
import { resolve } from 'path'
export default defineConfig({
  base: process.env.SITE_BASE || '/',
  server: { fs: { allow: ['../..'] } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'viewer.html'),
      },
    },
  },
})

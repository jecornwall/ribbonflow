import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  server: {
    fs: {
      // Allow Vite to serve files from the workspace root so workspace-linked
      // packages (@flow-designer/library) resolve correctly.
      allow: [resolve(__dirname, '../../../..')],
    },
  },
})

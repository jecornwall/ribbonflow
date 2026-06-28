import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Allow Vite to serve files from the workspace root so workspace-linked
      // packages (@ribbonflow/core) resolve correctly.
      allow: [resolve(__dirname, '../../../..')],
    },
  },
})

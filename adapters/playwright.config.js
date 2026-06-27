import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'smoke.spec.js',
  webServer: [
    { command: 'pnpm exec vite vue/example --port 5191 --strictPort', port: 5191, reuseExistingServer: true },
    { command: 'pnpm exec vite react/example --port 5192 --strictPort', port: 5192, reuseExistingServer: true },
  ],
  use: { headless: true },
})

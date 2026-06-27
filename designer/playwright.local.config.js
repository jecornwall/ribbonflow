/**
 * playwright.local.config.js — Playwright config for the STATIC-APP path
 * (bd ai-engineer-zr7k §7.2).
 *
 * The default designer dev server (npm run dev) sets VITE_FLOW_BACKEND=server,
 * so every spec under the main playwright.config.js runs against the file
 * backend. This config instead boots a plain `vite` on port 5175
 * (npm run dev:local) — NO flag, so flowStore selects the localStorage backend
 * — and runs ONLY persistence.spec.js, the static-app persistence round-trip
 * (create → reload → still there → export → delete → import).
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: 'persistence.spec.js',

  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5175',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Boot the designer with NO backend flag → localStorage backend. */
  webServer: {
    command: 'npm run dev:local',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: process.env.CI ? 'pipe' : 'ignore',
    stderr: 'pipe',
  },
})

/**
 * playwright.config.js — Playwright configuration for the flow designer's
 * smoke test suite (bd ai-engineer-99hk).
 *
 * Scope: E2E smoke tests only — node drag, export, import round-trip.
 * These live in test/smoke.spec.js alongside the headless unit tests.
 *
 * The webServer block auto-starts `vite dev` when the server isn't already
 * running (reuseExistingServer in non-CI). In CI, a fresh dev server is
 * always launched on port 5174.
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '*.spec.js',

  /* Global timeout per test */
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    /* Capture screenshot on failure for CI debugging */
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  /* Only Chromium — keeping the smoke test lean */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start the designer dev server if it isn't already running */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    /* Show server output in CI for debugging, suppress in local runs */
    stdout: process.env.CI ? 'pipe' : 'ignore',
    stderr: 'pipe',
  },
})

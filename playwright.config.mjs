// Browser tests of the canvas panel. Each test serves its own copy of the fixture workspace
// (tests/e2e/serve-workspace.mjs), so no web server is configured here.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: { viewport: { width: 1400, height: 1000 } },
})

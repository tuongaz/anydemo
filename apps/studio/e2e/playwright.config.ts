import { defineConfig } from '@playwright/test';

// Playwright config for the studio e2e tier (US-012).
// CI-aware: retries + traces + video kick in only under CI=true.
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './',
  outputDir: '../integration/.artifacts/playwright',
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['github'], ['html']] : [['list']],
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});

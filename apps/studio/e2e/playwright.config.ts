import { defineConfig } from '@playwright/test';

// Playwright config for the studio e2e tier (US-012).
// CI-aware: retries + traces + video kick in only under CI=true.
const isCI = !!process.env.CI;

// Visual-baseline (toHaveScreenshot / toMatchSnapshot) comparisons are skipped
// when SEEFLOW_IGNORE_SNAPSHOTS=1 so they never block the test/deploy pipeline
// (set in .github/workflows/_tests.yml). Functional e2e still runs. Local runs
// and `bun run test:it:update-snapshots` leave it unset, so visual assertions
// keep running / regenerating there.
const ignoreSnapshots = process.env.SEEFLOW_IGNORE_SNAPSHOTS === '1';

export default defineConfig({
  testDir: './',
  // Files end in `.e2e.ts` rather than `.spec.ts` because bun's default test
  // discovery picks up `*.spec.ts` everywhere (including under `e2e/`) and
  // tries to run Playwright specs through bun's test runner, which fails on
  // the missing `test`/`expect` globals. The `.e2e.ts` suffix dodges bun's
  // matcher while still being explicit about intent.
  testMatch: '**/*.e2e.ts',
  ignoreSnapshots,
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

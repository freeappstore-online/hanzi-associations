import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, fullyParallel: false,
  use: { baseURL: process.env.YI_TEST_URL || 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }, { name: 'desktop', use: { viewport: { width: 1366, height: 900 } } }],
  webServer: process.env.YI_TEST_URL ? undefined : { command: 'pnpm --filter @hanzi-associations/web preview --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
})

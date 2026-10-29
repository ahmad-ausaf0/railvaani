import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4200',
    ...devices['Pixel 5'],
  },
  webServer: {
    command: 'npm run start -w @railvaani/web',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
  },
});

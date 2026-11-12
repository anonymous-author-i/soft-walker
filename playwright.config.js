import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 90000, expect: {timeout: 30000}, workers: 1,
  reporter: 'list', use: {baseURL: 'http://127.0.0.1:8000', viewport: {width: 1200, height: 900}, screenshot: 'only-on-failure'},
  webServer: {command: 'python3 tools/serve.py', url: 'http://127.0.0.1:8000', reuseExistingServer: true},
  projects: [
    {name: 'chrome', use: {browserName: 'chromium', launchOptions: {executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader']}}},
    {name: 'firefox', use: {browserName: 'firefox'}},
    ...(process.env.EDGE_BIN ? [{name: 'edge', use: {browserName: 'chromium', launchOptions: {executablePath: process.env.EDGE_BIN, args: ['--no-sandbox', '--enable-unsafe-swiftshader']}}}] : []),
  ],
});

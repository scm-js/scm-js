import { defineConfig, devices } from '@playwright/test'

// The browser tests (`e2e/`) run against the built bundle — `npm run build` first — served
// by `vite preview`, because that is what ships: the lazy dialog chunks, the vendored
// plugins and the boot splash in index.html only exist together there. `SCMJS_E2E_URL`
// points them at a server already running instead (the dev server, a deployed build).
const PORT = 4173
const external = process.env.SCMJS_E2E_URL

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: external ?? `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
  },
  // Chromium only: it is the engine of the desktop build, and the one whose headless
  // shell the guide's screenshots already use.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } },
  ],
  webServer: external
    ? undefined
    : {
        command: `npx vite preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/`,
        reuseExistingServer: !process.env.CI,
      },
})

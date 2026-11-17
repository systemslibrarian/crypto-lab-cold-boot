import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build served by `vite preview`, so what
 * passes here is what ships.
 *
 * Port 4753 is unique to this lab across every cloned lab's committed config.
 * Never the Vite default 4173: a shared port means `reuseExistingServer`
 * silently scans a DIFFERENT lab's preview, and during a mutation check it can
 * scan an unmutated checkout still running from a previous run, which reads as
 * "the mutation was not caught".
 *
 * 4753 is NOT what the catalog's `node tools/port-sync.js` offered. It offered
 * 4245, and 4245 is taken: `crypto-lab-quic-packet` and
 * `crypto-lab-pseudorandom-code` both declare it in their committed configs,
 * and quic-packet was serving on it while this lab was being built -- which is
 * precisely the "scanned a different lab's preview" failure, caught here only
 * because the collision happened to be live. Neither of those two labs appears
 * in `tools/playwright-ports.json`, so port-sync's registry cannot see the port
 * they hold and hands it out as free. 4753 was chosen instead by scanning the
 * `playwright.config.ts` of every cloned lab on disk as well as the registry,
 * and taking the first port above the whole used range. Re-run port-sync to
 * pin it once those two labs are registered.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // The axe driver walks every exhibit, runs a real key recovery and measures
  // twenty more before it is done.
  timeout: 1_800_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4753/crypto-lab-cold-boot/',
    // Dark is the only theme.
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Claims run in one engine: they assert what the page SAYS and what it
    // COMPUTES, neither of which varies by browser.
    { name: 'claims', testMatch: /claims\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Build before serving: `vite preview` only serves whatever is already in
    // dist/, so without this a failing build leaves the previous good bundle
    // in place and the suite passes green against code that no longer
    // compiles. `--strictPort` keeps a collision visible instead of silently
    // taking the next free port.
    command: 'npm run build && npm run preview -- --port 4753 --strictPort',
    url: 'http://localhost:4753/crypto-lab-cold-boot/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

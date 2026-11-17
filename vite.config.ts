import { defineConfig, configDefaults } from 'vitest/config';

// base must match the GitHub Pages project subpath:
// https://systemslibrarian.github.io/crypto-lab-cold-boot/
export default defineConfig({
  base: '/crypto-lab-cold-boot/',
  worker: { format: 'es' },
  test: {
    // Colocated unit tests only; Playwright specs in e2e/ stay out of Vitest.
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    testTimeout: 20_000,
  },
});

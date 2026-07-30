import { defineConfig } from 'vitest/config'

// The Cloudflare worker modules live outside packages/*, so the web package's vitest
// project never saw them and CI never ran these 123 tests. Own config, own scope —
// same shape as tests/integration/vitest.config.ts.
export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.js'],
    environment: 'node',
    root: import.meta.dirname,
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Scoped to this directory on purpose. Vitest resolves `include` from the
    // cwd, and this config is run from the repository root, so a bare
    // '**/*.spec.ts' also collected packages/mobile/__tests__/e2e/**, whose
    // WebdriverIO specs use a global `describe` that does not exist under
    // vitest — 42 files failed with "describe is not defined". CI worked around
    // it by passing an explicit `tests/integration` path argument; the README's
    // documented command did not, so it was broken as written.
    //
    // Keeping the root at the repository root (rather than setting `root` here)
    // means CI's extra path filter still matches these files.
    include: ['tests/integration/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})

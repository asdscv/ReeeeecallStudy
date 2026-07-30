/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@reeeeecall/shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules', 'e2e/**'],
    // `lib/supabase.ts` throws at import time when the keys are missing, so any
    // suite that transitively imports it died on CI ("Missing Supabase environment
    // variables") while passing on machines that happened to export VITE_* in the
    // shell. Tests must never depend on a developer's environment: these dummy
    // values make the module importable. A test that actually reaches the network
    // with them fails loudly, which is the correct outcome for a missing mock.
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? 'test-anon-key',
    },
  },
})

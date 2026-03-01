/**
 * Shared Vitest configuration for simple packages.
 * Used by packages with basic test needs.
 *
 * Note: 2-minute timeout for tests that spawn large (359MB) stripped binaries.
 * These binaries take significant time to load into memory and execute.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 120_000, // 2 minutes for large binary spawning
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      exclude: [
        '**/node_modules/**',
        '**/build/**',
        '**/dist/**',
        '**/test/**',
        '**/*.test.{js,mjs,ts,mts}',
        '**/*.config.{js,mjs,ts,mts}',
        '**/scripts/**',
      ],
    },
  },
})

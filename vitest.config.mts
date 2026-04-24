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
    coverage: {
      exclude: [
        '**/*.config.{js,mjs,ts,mts}',
        '**/*.test.{js,mjs,ts,mts}',
        '**/build/**',
        '**/dist/**',
        '**/node_modules/**',
        '**/scripts/**',
        '**/test/**',
      ],
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
    },
    deps: {
      interopDefault: false,
    },
    globals: true,
    hookTimeout: 30_000,
    testTimeout: 120_000, // 2 minutes for large binary spawning
  },
})

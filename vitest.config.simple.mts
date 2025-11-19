/**
 * Shared Vitest configuration for simple packages.
 * Used by packages with basic test needs (30s timeouts for SEA tests).
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})

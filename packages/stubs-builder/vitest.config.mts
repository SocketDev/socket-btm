/**
 * Extends shared vitest config.
 * Tighter hookTimeout for curl/mbedTLS setup and faster testTimeout
 * for lightweight stub binary tests.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Override base hookTimeout (30s) for curl/mbedTLS build setup
      hookTimeout: 60_000,
      // Override base testTimeout (120s) for faster stub binary tests
      testTimeout: 60_000,
    },
  }),
)

import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Override base testTimeout (120s) for faster stub binary tests
      testTimeout: 60_000,
      // Override base hookTimeout (30s) for curl/mbedTLS build setup
      hookTimeout: 60_000,
    },
  }),
)

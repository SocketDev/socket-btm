/**
 * Extends shared vitest config.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      testTimeout: 30_000,
    },
  }),
)

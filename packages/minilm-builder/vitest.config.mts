/**
 * Extends shared vitest config.
 * Uses default 2-minute timeout from base config (sufficient for model builder tests).
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Base config provides 120s timeout, which is sufficient for model builder tests
    },
  }),
)

/**
 * Extends shared vitest config — ultraviolet-builder tests exercise
 * Go N-API bindings which load quickly, so override to the 30s
 * testTimeout rather than inherit the 2-minute binary-spawn default.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.test.mts'],
      testTimeout: 30_000,
    },
  }),
)

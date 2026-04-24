/**
 * Extends shared vitest config — Go-backed N-API framework tests use
 * the 30s timeout override because Go binaries load faster than the
 * base config's 2-minute default aimed at large stripped binaries.
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

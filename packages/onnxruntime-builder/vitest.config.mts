/**
 * Extends shared vitest config.
 * Excludes build and upstream directories.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      exclude: ['**/build/**', '**/node_modules/**', '**/upstream/**'],
    },
  }),
)

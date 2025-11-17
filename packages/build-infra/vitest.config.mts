/**
 * Extends shared simple vitest config.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.simple.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      preserveSymlinks: false,
    },
    test: {
      pool: 'vmForks',
    },
  }),
)

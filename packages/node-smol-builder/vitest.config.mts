/**
 * Extends shared simple vitest config.
 * Excludes build directories which contain Node.js test fixtures.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.simple.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      exclude: [
        '**/build/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/submodule/**',
      ],
    },
  }),
)

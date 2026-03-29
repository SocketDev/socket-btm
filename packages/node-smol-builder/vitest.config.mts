/**
 * Extends shared vitest config.
 * Excludes build directories which contain Node.js test fixtures.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      setupFiles: ['./test/helpers/primordials-shim.mjs'],
      // Integration tests share temp dirs and the ~/.socket/_dlx/ cache.
      // Run files sequentially to prevent race conditions.
      fileParallelism: false,
      exclude: [
        '**/build/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/upstream/**',
      ],
    },
  }),
)

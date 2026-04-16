/**
 * Extends shared vitest config.
 * Uses forks pool for process isolation during compression/decompression tests.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

// @ts-check
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Use forks pool for full process isolation
      // This prevents file system race conditions when tests manipulate binaries
      // and sign them with codesign, which can leave file handles open
      pool: 'forks',
      poolOptions: {
        forks: {
          // Run all tests in single fork sequentially
          singleFork: true,
          // Full isolation between test files
          isolate: true,
        },
      },
    },
  }),
)

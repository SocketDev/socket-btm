/**
 * Extends shared vitest config.
 * Uses forks pool with singleFork for codesigning compatibility.
 *
 * IMPORTANT: Must use forks pool with singleFork=true because:
 * 1. Codesigning operations on macOS can leave file handles open
 * 2. Multiple concurrent test processes can cause race conditions
 * 3. Sequential execution in single fork prevents these issues
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

// @ts-check
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Use forks pool for full process isolation (required for codesigning)
      pool: 'forks',
      poolOptions: {
        forks: {
          // Run all tests in single fork sequentially (prevents codesign race conditions)
          singleFork: true,
          // Full isolation between test files
          isolate: true,
        },
      },
    },
  }),
)

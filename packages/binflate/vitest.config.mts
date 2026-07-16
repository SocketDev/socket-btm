/**
 * Extends shared vitest config.
 * Uses forks pool for process isolation during compression/decompression tests.
 */
import type { ViteUserConfig } from 'vitest/config'

import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/repo/vitest.config.mts'

// oxlint-disable-next-line socket/no-default-export -- vitest CLI auto-discovers config via default import.
export default mergeConfig(
  baseConfig as ViteUserConfig,
  defineConfig({
    test: {
      // Use forks pool for full process isolation
      // This prevents file system race conditions when tests manipulate binaries
      // and sign them with codesign, which can leave file handles open
      pool: 'forks',
      // fileParallelism: false is the vitest 4 replacement for poolOptions.forks.singleFork: true
      // Runs all test files sequentially in a single fork for full isolation
      fileParallelism: false,
    },
  }),
)

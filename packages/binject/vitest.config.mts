/**
 * Extends shared vitest config.
 * Uses forks pool with sequential file runs for codesigning compatibility.
 *
 * IMPORTANT: Must use the forks pool with fileParallelism: false because:
 * 1. Codesigning operations on macOS can leave file handles open
 * 2. Multiple concurrent test processes can cause race conditions
 * 3. Sequential execution in a single fork prevents these issues.
 */
import type { ViteUserConfig } from 'vitest/config'

import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/repo/vitest.config.mts'

// oxlint-disable-next-line socket/no-default-export -- vitest CLI auto-discovers config via default import.
export default mergeConfig(
  baseConfig as ViteUserConfig,
  defineConfig({
    test: {
      // Use forks pool for full process isolation (required for codesigning)
      pool: 'forks',
      // fileParallelism: false is the vitest 4 replacement for
      // poolOptions.forks.singleFork: true — all test files run sequentially
      // in a single fork.
      fileParallelism: false,
    },
  }),
)

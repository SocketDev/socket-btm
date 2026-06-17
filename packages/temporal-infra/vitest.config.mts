/**
 * Extends shared vitest config — temporal-infra's unit tests are pure
 * regex / classifier checks with no binary spawning, so the 30s
 * timeout is comfortably over-budget.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/repo/vitest.config.mts'

// oxlint-disable-next-line socket/no-default-export -- vitest CLI auto-discovers config via default import.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.test.mts'],
      testTimeout: 30_000,
    },
  }),
)

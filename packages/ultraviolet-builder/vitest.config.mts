/**
 * Extends shared vitest config — ultraviolet-builder tests exercise
 * Go N-API bindings which load quickly, so override to the 30s
 * testTimeout rather than inherit the 2-minute binary-spawn default.
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

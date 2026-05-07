/**
 * Extends shared vitest config.
 * Uses default 2-minute timeout from base config (sufficient for model builder tests).
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/repo/vitest.config.mts'

// oxlint-disable-next-line socket/no-default-export -- vitest CLI auto-discovers config via default import.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Base config provides 120s timeout, which is sufficient for model builder tests
    },
  }),
)

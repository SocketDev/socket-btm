/**
 * Extends shared vitest config.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/repo/vitest.config.mts'

// oxlint-disable-next-line socket/no-default-export -- vitest CLI auto-discovers config via default import.
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

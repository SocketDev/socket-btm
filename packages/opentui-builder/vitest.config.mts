/**
 * Extends shared vitest config.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/vitest.config.mts'

// oxlint-disable-next-line socket/no-default-export -- vitest CLI auto-discovers config via default import.
export default mergeConfig(
  baseConfig,
  defineConfig({
    assetsInclude: ['**/*.node'],
    server: {
      fs: {
        allow: ['..'],
      },
    },
    test: {
      include: ['test/**/*.test.{mjs,mts,js,ts}'],
      server: {
        deps: {
          external: ['*.node'],
        },
      },
      testTimeout: 30_000,
    },
  }),
)

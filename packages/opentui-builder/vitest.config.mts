/**
 * Extends shared vitest config.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

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
      testTimeout: 30_000,
      server: {
        deps: {
          external: ['*.node'],
        },
      },
    },
  }),
)

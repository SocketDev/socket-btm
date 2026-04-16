import { mergeConfig, defineConfig } from 'vitest/config'
import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.test.{js,mjs,ts,mts}'],
      testTimeout: 30000,
    },
  }),
)

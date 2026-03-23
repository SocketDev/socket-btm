/**
 * Extends shared vitest config.
 * Excludes build directory (contains large ONNX model files).
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      exclude: ['**/build/**', '**/node_modules/**'],
    },
  }),
)

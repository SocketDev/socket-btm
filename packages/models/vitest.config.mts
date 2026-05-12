/* oxlint-disable socket/no-default-export -- vitest CLI auto-discovers config via default import. */
/**
 * Extends shared vitest config.
 * Excludes build directory (contains large ONNX model files).
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      exclude: ['**/build/**', '**/node_modules/**'],
    },
  }),
)

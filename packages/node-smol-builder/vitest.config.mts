/**
 * Extends shared vitest config.
 * Excludes build directories which contain Node.js test fixtures.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/vitest.config.mts'

// oxlint-disable-next-line socket/no-default-export -- vitest CLI auto-discovers config via default import.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // TEMP(validation): 20+ existing test files use bare describe/it/expect
      // (written against the old globals:true base). Re-enable until the
      // fleet decides globals true→false migration. See validation plan.
      globals: true,
      exclude: [
        '**/build/**',
        '**/dist/**',
        '**/node_modules/**',
        '**/upstream/**',
      ],
      // Integration tests share temp dirs and the ~/.socket/_dlx/ cache.
      // Run files sequentially to prevent race conditions.
      fileParallelism: false,
      setupFiles: ['./test/helpers/primordials-shim.mts'],
    },
  }),
)

/**
 * Extends the shared vitest config. The phase-1 integration test compiles
 * codesign-infra against BoringSSL and runs Apple's `codesign -v`, so it needs
 * headroom over the default timeout for the one-time clang invocation.
 */
import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../.config/repo/vitest.config.mts'

// oxlint-disable-next-line socket/no-default-export -- vitest CLI auto-discovers config via default import.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.test.mts'],
      testTimeout: 60_000,
    },
  }),
)

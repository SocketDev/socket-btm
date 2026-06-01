/**
 * Shared Vitest configuration for simple packages.
 * Used by packages with basic test needs.
 *
 * Note: 2-minute timeout for tests that spawn large (359MB) stripped binaries.
 * These binaries take significant time to load into memory and execute.
 */
import { defineConfig } from 'vitest/config'

// oxlint-disable-next-line socket/no-default-export -- vitest's CLI auto-discovers configs via default import; the rule's
export default defineConfig({
  // Keep vitest's cache under node_modules so `pnpm install`
  // clears it automatically — no dedicated clean step.
  cacheDir: './node_modules/.cache/vitest',
  test: {
    coverage: {
      exclude: [
        '**/*.config.{js,mjs,ts,mts}',
        '**/*.test.{js,mjs,ts,mts}',
        '**/build/**',
        '**/dist/**',
        '**/node_modules/**',
        '**/scripts/**',
        '**/test/**',
      ],
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
    },
    deps: {
      interopDefault: false,
    },
    globals: true,
    hookTimeout: 30_000,
    // Scope discovery to real test files. Without an explicit include +
    // exclude, vitest's module-graph walk (e.g. `vitest related` in the
    // pre-commit hook) reaches into vendored `upstream/` submodule
    // fixtures that `import … from './foo.wasm'`, which vite's default
    // loader can't transform — surfacing as a spurious "ESM integration
    // proposal for Wasm" failure. Excluding the vendored trees keeps the
    // walk inside our own suites.
    include: ['**/test/**/*.test.{js,ts,mjs,mts,cjs}'],
    exclude: [
      '**/build/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/test/fixtures/**',
      '**/upstream/**',
      '.claude/hooks/**/test/**',
      '.config/oxlint-plugin/test/**',
      '.git-hooks/**',
      'scripts/**/test/**',
    ],
    testTimeout: 120_000, // 2 minutes for large binary spawning
  },
})

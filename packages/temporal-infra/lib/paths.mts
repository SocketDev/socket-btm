/**
 * @file Path helpers for temporal-infra.
 *   Single source of truth (1 path, 1 reference) for where temporal-infra's
 *   C++ source lives. Consumers (currently node-smol-builder's additions
 *   copy step) import these instead of hardcoding paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Package root: packages/temporal-infra/
 */
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

/**
 * C++ source root: packages/temporal-infra/src/socketsecurity/temporal/
 */
export const TEMPORAL_SRC_DIR = path.join(
  PACKAGE_ROOT,
  'src',
  'socketsecurity',
  'temporal',
)

/**
 * Upstream submodule root (read-only parity reference).
 */
export const UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'temporal')

/**
 * Test262 corpus root (sparse-checkout submodule, pinned in
 * .gitmodules; sparse pattern keeps just the Temporal subset).
 */
export const TEST262_ROOT = path.join(
  PACKAGE_ROOT,
  'test',
  'fixtures',
  'test262',
)

/**
 * Test262 `test/` subdir — what runners walk.
 */
export const TEST262_TEST_DIR = path.join(TEST262_ROOT, 'test')

/**
 * Test262 `harness/` subdir — sta.js / assert.js / etc.
 */
export const TEST262_HARNESS_DIR = path.join(TEST262_ROOT, 'harness')

/**
 * Temporal API tests: test/built-ins/Temporal/
 */
export const TEST262_TEMPORAL_BUILTINS_DIR = path.join(
  TEST262_TEST_DIR,
  'built-ins',
  'Temporal',
)

/**
 * Temporal intl402 tests: test/intl402/Temporal/
 */
export const TEST262_TEMPORAL_INTL402_DIR = path.join(
  TEST262_TEST_DIR,
  'intl402',
  'Temporal',
)

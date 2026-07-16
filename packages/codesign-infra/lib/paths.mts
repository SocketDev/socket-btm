/**
 * @file Path helpers for codesign-infra. Single source of truth (1 path, 1
 *   reference) for where codesign-infra's C++ source lives. Consumers
 *   (binject's re-sign seam, once integrated) import these instead of
 *   hardcoding paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Package root: packages/codesign-infra/
 */
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

/**
 * C++ source root: packages/codesign-infra/src/socketsecurity/codesign/
 */
export const CODESIGN_SRC_DIR = path.join(
  PACKAGE_ROOT,
  'src',
  'socketsecurity',
  'codesign',
)

/**
 * Include ROOT: packages/codesign-infra/include/ — pass to the compiler as `-I`
 * so `#include "socketsecurity/codesign/codesign.h"` resolves.
 */
export const CODESIGN_INCLUDE_ROOT = path.join(PACKAGE_ROOT, 'include')

/**
 * Public headers dir: packages/codesign-infra/include/socketsecurity/codesign/
 * (where codesign.h lives). Use CODESIGN_INCLUDE_ROOT for the compiler `-I`.
 */
export const CODESIGN_INCLUDE_DIR = path.join(
  CODESIGN_INCLUDE_ROOT,
  'socketsecurity',
  'codesign',
)

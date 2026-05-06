/**
 * @fileoverview Path helpers for temporal-infra.
 *
 * Single source of truth (1 path, 1 reference) for where temporal-infra's
 * C++ source lives. Consumers (currently node-smol-builder's additions
 * copy step) import these instead of hardcoding paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Package root: packages/temporal-infra/ */
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

/** C++ source root: packages/temporal-infra/src/socketsecurity/temporal/ */
export const TEMPORAL_SRC_DIR = path.join(
  PACKAGE_ROOT,
  'src',
  'socketsecurity',
  'temporal',
)

/** Upstream submodule root (read-only parity reference). */
export const UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'temporal')

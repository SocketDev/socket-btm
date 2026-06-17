/**
 * @fileoverview Path helpers for tui-infra.
 *
 * Single source of truth (1 path, 1 reference) for where tui-infra's
 * C++ source lives. Consumers (currently node-smol-builder's additions
 * copy step) import these instead of hardcoding paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Package root: packages/tui-infra/ */
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

/** C++ source root: packages/tui-infra/src/socketsecurity/tui/ */
export const TUI_SRC_DIR = path.join(
  PACKAGE_ROOT,
  'src',
  'socketsecurity',
  'tui',
)

/** Public include root: packages/tui-infra/include/tui/ */
export const TUI_INCLUDE_DIR = path.join(PACKAGE_ROOT, 'include', 'tui')

/** Upstream OpenTUI submodule root (read-only parity reference). */
export const UPSTREAM_OPENTUI_DIR = path.join(
  PACKAGE_ROOT,
  'upstream',
  'opentui',
)

/** Upstream Yoga submodule root (read-only parity reference). */
export const UPSTREAM_YOGA_DIR = path.join(PACKAGE_ROOT, 'upstream', 'yoga')

/**
 * @fileoverview Path helpers for lsquic-infra.
 *
 * Single source of truth (1 path, 1 reference) for where lsquic-infra's
 * upstream submodule sources live. Consumers (currently node-smol-builder's
 * additions copy step) import these instead of hardcoding paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Package root: packages/lsquic-infra/ */
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

/** Upstream lsquic submodule root (read-only parity reference). */
export const UPSTREAM_LSQUIC_DIR = path.join(
  PACKAGE_ROOT,
  'upstream',
  'lsquic',
)

/** lsquic engine sources: upstream/lsquic/src/liblsquic/ */
export const LSQUIC_SRC_DIR = path.join(
  UPSTREAM_LSQUIC_DIR,
  'src',
  'liblsquic',
)

/** lsquic public headers: upstream/lsquic/include/ */
export const LSQUIC_INCLUDE_DIR = path.join(
  UPSTREAM_LSQUIC_DIR,
  'include',
)

/** Upstream ls-qpack submodule root. */
export const UPSTREAM_LS_QPACK_DIR = path.join(
  PACKAGE_ROOT,
  'upstream',
  'ls-qpack',
)

/** ls-qpack sources (mostly headers + lsqpack.c). */
export const LS_QPACK_SRC_DIR = UPSTREAM_LS_QPACK_DIR

/** Our patches dir — bun's 3 verbatim patches against lsquic. */
export const PATCHES_DIR = path.join(PACKAGE_ROOT, 'patches', 'lsquic')

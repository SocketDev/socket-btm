/**
 * Centralized path resolution for napi-go (self-build paths — the
 * downstream CLI is in cli/src/resolve.mts).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const PACKAGE_ROOT = path.resolve(__dirname, '..')
export const SRC_DIR = path.join(PACKAGE_ROOT, 'src')
export const INCLUDE_DIR = path.join(PACKAGE_ROOT, 'include')
export const CSHIM_DIR = path.join(PACKAGE_ROOT, 'cshim')
export const EXAMPLES_DIR = path.join(PACKAGE_ROOT, 'examples')
export const HELLO_DIR = path.join(EXAMPLES_DIR, 'hello')
export const HELLO_GO_DIR = path.join(HELLO_DIR, 'src')
export const HELLO_SHIM = path.join(HELLO_GO_DIR, 'shim.c')
export const LIB_DIR = path.join(PACKAGE_ROOT, 'lib')

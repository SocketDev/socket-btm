/**
 * Path resolution for ultraviolet-builder.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const PACKAGE_ROOT = path.resolve(__dirname, '..')
export const SRC_DIR = path.join(PACKAGE_ROOT, 'src')
export const GO_SHIM = path.join(SRC_DIR, 'shim.c')
export const LIB_DIR = path.join(PACKAGE_ROOT, 'lib')

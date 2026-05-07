/**
 * Path utilities for ink package.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const PACKAGE_ROOT = path.resolve(__dirname, '..')
export const BUILD_DIR = path.join(PACKAGE_ROOT, 'build')
export const PATCHES_DIR = path.join(PACKAGE_ROOT, 'patches')
export const DIST_DIR = path.join(PACKAGE_ROOT, 'dist')

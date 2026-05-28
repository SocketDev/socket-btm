/**
 * Centralized path resolution for boringssl-builder.
 */

export * from '../../../scripts/paths.mts'

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const PACKAGE_ROOT = path.resolve(__dirname, '..')
export const UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'boringssl')
export const BUILD_DIR = path.join(PACKAGE_ROOT, 'build')

const MODE = process.env['BUILD_MODE'] ?? 'release'
const PLATFORM_ARCH = `${process.platform}-${process.arch}`

export function getPaths(): {
  packageRoot: string
  buildDir: string
  outFinal: string
  cmakeBuildDir: string
} {
  const buildDir = path.join(BUILD_DIR, MODE, PLATFORM_ARCH)
  const outFinal = path.join(buildDir, 'out', 'Final')
  return {
    packageRoot: PACKAGE_ROOT,
    buildDir,
    outFinal,
    cmakeBuildDir: path.join(buildDir, 'cmake'),
  }
}

/**
 * Centralized path resolution for boringssl-builder.
 */

export * from '../../../scripts/paths.mts'

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getPlatformBuildDir } from 'build-infra/lib/constants'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const PACKAGE_ROOT = path.resolve(__dirname, '..')
export const UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'boringssl')

const PLATFORM_ARCH =
  process.env['TARGET_ARCH'] || `${process.platform}-${process.arch}`

export const PREFIX = 'smol'

export function getPaths(): {
  packageRoot: string
  buildDir: string
  outFinal: string
  outLibDir: string
  outIncludeDir: string
  cmakeBuildDir: string
} {
  const buildDir = getPlatformBuildDir(PACKAGE_ROOT, PLATFORM_ARCH)
  const outFinal = path.join(buildDir, 'out', 'Final')
  return {
    packageRoot: PACKAGE_ROOT,
    buildDir,
    outFinal,
    outLibDir: path.join(outFinal, 'lib'),
    outIncludeDir: path.join(outFinal, 'include'),
    cmakeBuildDir: path.join(buildDir, 'cmake'),
  }
}

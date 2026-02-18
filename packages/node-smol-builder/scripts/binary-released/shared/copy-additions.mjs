/**
 * Copy build additions to Node.js source tree.
 * Handles placeholder replacement for version strings in JS files.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { ADDITIONS_SOURCE_PATCHED_DIR, PACKAGE_ROOT } from './paths.mjs'

const logger = getDefaultLogger()

/**
 * Copy build additions to Node.js source tree.
 *
 * @param {string} modeSourceDir - Target Node.js source directory
 */
/**
 * Process file content for placeholders.
 * Returns object with processed content and whether file was processed.
 */
async function processFileContent(sourcePath, version) {
  const ext = path.extname(sourcePath)

  // For JS files, replace placeholders.
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const stats = await fs.stat(sourcePath)
    let content = await fs.readFile(sourcePath, 'utf8')
    content = content.replaceAll('%SMOL_VERSION%', version)
    return { content, mode: stats.mode, processed: true }
  }

  return { processed: false }
}

/**
 * Recursively copy directory with placeholder replacement.
 */
async function copyDirectoryRecursive(source, dest, version) {
  await safeMkdir(dest)

  const entries = await fs.readdir(source, { withFileTypes: true })
  let fileCount = 0

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      // Recursively copy subdirectory.
      fileCount += await copyDirectoryRecursive(sourcePath, destPath, version)
    } else if (entry.isFile()) {
      const { content, mode, processed } = await processFileContent(
        sourcePath,
        version,
      )

      if (processed) {
        // Write processed JS file with original permissions.
        await fs.writeFile(destPath, content)
        await fs.chmod(destPath, mode)
      } else {
        // Copy file as-is.
        await fs.copyFile(sourcePath, destPath)
      }

      fileCount++
    }
  }

  return fileCount
}

export async function copyBuildAdditions(modeSourceDir) {
  logger.step('Copying Build Additions')

  // Read package.json version for placeholder replacement.
  const pkgJsonPath = path.join(PACKAGE_ROOT, 'package.json')
  const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'))
  const version = pkgJson.version

  if (!existsSync(ADDITIONS_SOURCE_PATCHED_DIR)) {
    throw new Error(
      `Build additions source directory not found: ${ADDITIONS_SOURCE_PATCHED_DIR}`,
    )
  }

  const fileCount = await copyDirectoryRecursive(
    ADDITIONS_SOURCE_PATCHED_DIR,
    modeSourceDir,
    version,
  )

  logger.success(`Copied ${fileCount} file(s) from additions/`)
  logger.log('')
}

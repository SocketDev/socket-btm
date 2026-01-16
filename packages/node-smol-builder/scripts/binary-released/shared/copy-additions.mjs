/**
 * Copy build additions to Node.js source tree.
 * Handles placeholder replacement for version strings in JS files.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { ADDITIONS_MAPPINGS, PACKAGE_ROOT } from './paths.mjs'

const logger = getDefaultLogger()

/**
 * Copy build additions to Node.js source tree.
 *
 * @param {string} modeSourceDir - Target Node.js source directory
 */
export async function copyBuildAdditions(modeSourceDir) {
  logger.step('Copying Build Additions')

  // Read package.json version for placeholder replacement.
  const pkgJsonPath = path.join(PACKAGE_ROOT, 'package.json')
  const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'))
  const version = pkgJson.version

  for (const { dest, source } of ADDITIONS_MAPPINGS) {
    if (!existsSync(source)) {
      logger.skip(`Source directory not found: ${source}`)
      continue
    }

    const destDir = path.join(modeSourceDir, dest)
    await safeMkdir(destDir)

    // Copy all files from source to destination.
    const files = await fs.readdir(source)
    for (const file of files) {
      const sourcePath = path.join(source, file)
      const destPath = path.join(destDir, file)
      const ext = path.extname(file)

      // For JS files, read and potentially replace placeholders.
      if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        const stats = await fs.stat(sourcePath)
        let content = await fs.readFile(sourcePath, 'utf8')
        content = content.replaceAll('%SMOL_VERSION%', version)
        await fs.writeFile(destPath, content)
        await fs.chmod(destPath, stats.mode)
      } else {
        await fs.copyFile(sourcePath, destPath)
      }
    }

    logger.success(`Copied ${files.length} file(s) to ${dest}/`)
  }

  logger.log('')
}

#!/usr/bin/env node
/**
 * Update Node.js version across the repository
 * Usage: node scripts/update-node-version.mjs <new-version>
 * Example: node scripts/update-node-version.mjs 24.12.0
 */

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

const WIN32 = process.platform === 'win32'

/**
 * Main update function
 */
async function main() {
  let newVersion = process.argv[2]

  if (!newVersion) {
    logger.fail('Usage: node scripts/update-node-version.mjs <new-version>')
    logger.fail('Example: node scripts/update-node-version.mjs 24.12.0')
    process.exitCode = 1
    return
  }

  // Trim leading "v" if provided
  newVersion = newVersion.replace(/^v/, '')

  // Read old version
  let oldVersion = 'unknown'
  try {
    oldVersion = (
      await fs.promises.readFile(path.join(ROOT_DIR, '.node-version'), 'utf8')
    ).trim()
  } catch {
    // Ignore if file doesn't exist
  }

  logger.log(`Updating Node.js version from ${oldVersion} to ${newVersion}`)
  logger.log('')

  // 1. Update .node-version
  logger.step('Updating .node-version')
  await fs.promises.writeFile(
    path.join(ROOT_DIR, '.node-version'),
    `${newVersion}\n`,
    'utf8',
  )
  logger.success('Updated .node-version')
  logger.log('')

  // 2. Update node-smol-builder upstream
  logger.step('Updating node-smol-builder upstream')
  try {
    // First, get the SHA for the new version from GitHub
    logger.log(`Resolving SHA for v${newVersion}...`)
    const shaResult = await spawn(
      'git',
      ['ls-remote', 'https://github.com/nodejs/node.git', `v${newVersion}`],
      {
        cwd: ROOT_DIR,
        shell: WIN32,
      },
    )
    const shaLine = shaResult.stdout.toString().trim()
    if (!shaLine) {
      logger.warn(`Tag v${newVersion} not found in Node.js repository`)
    } else {
      // Parse SHA from git ls-remote output (format: "sha1\trefs/tags/vX.Y.Z")
      // Use regex match for robustness against format changes
      const shaMatch = shaLine.match(/^([a-f0-9]+)/)
      if (!shaMatch) {
        throw new Error(`Invalid git ls-remote output: ${shaLine}`)
      }
      const newSha = shaMatch[1]
      logger.success(`Found SHA: ${newSha}`)

      // Update .gitmodules
      logger.log('Updating .gitmodules')
      const gitmodulesPath = path.join(ROOT_DIR, '.gitmodules')
      const gitmodulesContent = await fs.promises.readFile(
        gitmodulesPath,
        'utf8',
      )
      const updated = gitmodulesContent
        .replace(
          /(\[submodule "packages\/node-smol-builder\/upstream\/node"\][^[]*# )v[^\n]+/,
          `$1v${newVersion}`,
        )
        .replace(
          /(\[submodule "packages\/node-smol-builder\/upstream\/node"\][^[]*ref = )[0-9a-f]+/,
          `$1${newSha}`,
        )
      await fs.promises.writeFile(gitmodulesPath, updated, 'utf8')

      // Initialize/update the submodule
      logger.log('Updating submodule...')
      await spawn(
        'git',
        [
          'submodule',
          'update',
          '--init',
          '--depth',
          '1',
          'packages/node-smol-builder/upstream/node',
        ],
        {
          cwd: ROOT_DIR,
          shell: WIN32,
          stdio: 'inherit',
        },
      )

      logger.success('Staging upstream update')
      await spawn(
        'git',
        ['add', 'packages/node-smol-builder/upstream/node', '.gitmodules'],
        {
          cwd: ROOT_DIR,
          shell: WIN32,
        },
      )
    }
  } catch (err) {
    logger.warn(`Failed to update upstream: ${err.message}`)
  }
  logger.log('')

  // 3. Update patch metadata
  logger.step('Updating patch metadata')
  const patchesDir = path.join(
    ROOT_DIR,
    'packages/node-smol-builder/patches/source-patched',
  )
  try {
    const files = await fs.promises.readdir(patchesDir)
    const patchFiles = files
      .filter(f => f.endsWith('.patch'))
      .map(f => path.join(patchesDir, f))

    if (patchFiles.length > 0) {
      logger.log(`Found ${patchFiles.length} patch(es) to update`)

      for (const patchFile of patchFiles) {
        const content = await fs.promises.readFile(patchFile, 'utf8')
        if (content.includes('@node-versions:')) {
          logger.log(`Updating metadata in ${path.basename(patchFile)}`)
          // Update any version format to new version
          // Handles: v24.11.1, v24+, v24.*, etc.
          const updated = content.replace(
            /@node-versions: v[0-9][^\s]*/g,
            `@node-versions: v${newVersion}`,
          )
          await fs.promises.writeFile(patchFile, updated, 'utf8')
        }
      }
      logger.success(`All patch metadata updated to v${newVersion}`)
      logger.warn('All patches must be regenerated against new Node.js source')
    } else {
      logger.log('No patches found')
    }
  } catch {
    logger.warn(
      `Patches directory not found: ${path.relative(ROOT_DIR, patchesDir)}`,
    )
  }
  logger.log('')

  logger.success('Node.js version update complete!')
  logger.log('')
  logger.log('Summary:')
  logger.log(`  Old version: ${oldVersion}`)
  logger.log(`  New version: ${newVersion}`)
  logger.log('')
  logger.log('Next steps:')
  logger.log('  1. Review changes: git diff')
  logger.log('  2. Regenerate ALL patches against new Node.js source:')
  logger.log(
    '     - Every patch must be regenerated, even if it applies cleanly',
  )
  logger.log(
    '     - See packages/node-smol-builder/patches/README.md for workflow',
  )
  logger.log('     - Never manually edit patch hunks')
  logger.log('  3. Test patches apply cleanly:')
  logger.log('     cd packages/node-smol-builder && pnpm run build')
  logger.log('  4. Test the new version')
  logger.log(
    `  5. Commit: git commit -am 'chore: update Node.js to v${newVersion}'`,
  )
}

main().catch(err => {
  logger.fail(`Error: ${err.message}`)

  process.exitCode = 1
})

#!/usr/bin/env node
/**
 * Update Node.js version across the repository
 * Usage: node scripts/update-node-version.mjs <new-version>
 * Example: node scripts/update-node-version.mjs 24.12.0
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

const WIN32 = process.platform === 'win32'

/**
 * Main update function
 */
async function main() {
  const newVersion = process.argv[2]

  if (!newVersion) {
    logger.fail('Usage: node scripts/update-node-version.mjs <new-version>')
    logger.fail('Example: node scripts/update-node-version.mjs 24.12.0')

    process.exit(1)
  }

  // Read old version
  let oldVersion = 'unknown'
  try {
    oldVersion = (
      await fs.readFile(path.join(ROOT_DIR, '.node-version'), 'utf8')
    ).trim()
  } catch {
    // Ignore if file doesn't exist
  }

  logger.log(`Updating Node.js version from ${oldVersion} to ${newVersion}`)
  logger.log('')

  // 1. Update .node-version
  logger.step('Updating .node-version')
  await fs.writeFile(
    path.join(ROOT_DIR, '.node-version'),
    `${newVersion}\n`,
    'utf8',
  )
  logger.success('Updated .node-version')
  logger.log('')

  // 2. Update node-smol-builder upstream
  logger.step('Updating node-smol-builder upstream')
  const upstreamPath = path.join(
    ROOT_DIR,
    'packages/node-smol-builder/upstream/node',
  )
  try {
    await fs.access(upstreamPath)

    // Fetch latest tags
    logger.log('Fetching latest Node.js tags...')
    await spawn('git', ['fetch', '--tags', 'origin'], {
      cwd: upstreamPath,
      shell: WIN32,
    })

    // Check if tag exists
    try {
      await spawn('git', ['rev-parse', `v${newVersion}`], {
        cwd: upstreamPath,
        shell: WIN32,
      })

      logger.success(`Checking out v${newVersion}`)
      await spawn('git', ['checkout', `v${newVersion}`], {
        cwd: upstreamPath,
        shell: WIN32,
      })

      logger.success('Staging upstream update')
      await spawn('git', ['add', 'packages/node-smol-builder/upstream/node'], {
        cwd: ROOT_DIR,
        shell: WIN32,
      })
    } catch {
      logger.warn(`Tag v${newVersion} not found in Node.js repository`)
      logger.log('Available recent tags:')
      const majorMinor = newVersion.split('.').slice(0, 2).join('.')
      const result = await spawn('git', ['tag', '-l', `v${majorMinor}*`], {
        cwd: upstreamPath,
        shell: WIN32,
      })
      const tags = result.stdout.toString().trim().split('\n').slice(-5)
      tags.forEach(tag => logger.log(`  ${tag}`))
    }
  } catch {
    logger.warn('node-smol-builder upstream not found')
  }
  logger.log('')

  // 3. Update patch metadata
  logger.step('Updating patch metadata')
  const patchesDir = path.join(
    ROOT_DIR,
    'packages/node-smol-builder/patches/source-patched',
  )
  try {
    await fs.access(patchesDir)
    const files = await fs.readdir(patchesDir)
    const patchFiles = files
      .filter(f => f.endsWith('.patch'))
      .map(f => path.join(patchesDir, f))

    if (patchFiles.length > 0) {
      logger.log(`Found ${patchFiles.length} patch(es) to update`)

      for (const patchFile of patchFiles) {
        const content = await fs.readFile(patchFile, 'utf8')
        if (content.includes('@node-versions:')) {
          logger.log(`Updating metadata in ${path.basename(patchFile)}`)
          // Update any version format to new version
          // Handles: v24.11.1, v24+, v24.*, etc.
          const updated = content.replace(
            /@node-versions: v[0-9][^\s]*/g,
            `@node-versions: v${newVersion}`,
          )
          await fs.writeFile(patchFile, updated, 'utf8')
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

  process.exit(1)
})

#!/usr/bin/env node
/**
 * Update Node.js version across the repository
 * Usage: node scripts/update-node-version.mts <new-version>
 * Example: node scripts/update-node-version.mts 24.12.0
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { errorMessage } from 'build-infra/lib/error-utils'
import { fetchNodeChecksum } from 'build-infra/lib/version-helpers'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

/**
 * Main update function
 */
async function main(): Promise<void> {
  const argv: string[] = process.argv
  let newVersion: string | undefined = argv[2]

  if (!newVersion) {
    logger.fail('Usage: node scripts/update-node-version.mts <new-version>')
    logger.fail('Example: node scripts/update-node-version.mts 24.12.0')
    process.exitCode = 1
    return
  }

  // Trim leading "v" if provided
  newVersion = newVersion.replace(/^v/, '')

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

  // Fetch the sha256 upfront, BEFORE any filesystem writes. The integrity
  // pin is the one-shot supply-chain guard; if SHASUMS256 is unreachable we
  // must abort before a partial write leaves the repo in a worse state
  // (new .node-version, stale .gitmodules SHA, patches re-labeled for a
  // version the build isn't actually targeting). R34 found that throwing
  // later inside the try/catch at step 2 was swallowed by its outer catch
  // — the gate wasn't actually blocking.
  logger.step('Validating SHASUMS256 reachability')
  const preflightChecksum = await fetchNodeChecksum(newVersion)
  if (!('hash' in preflightChecksum)) {
    logger.fail(
      `Could not fetch SHASUMS256 for v${newVersion}: ${preflightChecksum.error}. ` +
        `Aborting update to preserve the sha256 integrity pin. ` +
        `Rerun the update-node skill when SHASUMS256 is reachable.`,
    )
    process.exitCode = 1
    return
  }
  const nodeSha256 = preflightChecksum.hash
  logger.success(`SHASUMS256 reachable (sha256:${nodeSha256.slice(0, 12)}…)`)
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
    const shaLine = shaResult.stdout ? shaResult.stdout.toString().trim() : ''
    if (!shaLine) {
      logger.warn(
        `Tag v${newVersion} not found in Node.js repository — skipping .gitmodules update, continuing with patch metadata`,
      )
    } else {
      // Parse SHA from git ls-remote output (format: "sha1\trefs/tags/vX.Y.Z")
      // Use regex match for robustness against format changes
      const shaMatch = shaLine.match(/^([a-f0-9]+)/)
      if (!shaMatch) {
        throw new Error(`Invalid git ls-remote output: ${shaLine}`)
      }
      const newSha = shaMatch[1]
      logger.success(`Found SHA: ${newSha}`)

      // Update .gitmodules. The version comment lives on the line
      // IMMEDIATELY BEFORE `[submodule "..."]` in the format
      // `# node-X.Y.Z sha256:<hex>` (see .claude/rules/gitmodules-
      // version-comments.md). Rewrite that entire line, preserving
      // the trailing sha256 if we can fetch one from nodejs.org's
      // SHASUMS256.txt for the new tarball. Previous regex targeted
      // a pre-2025 format (`# v…` / `ref = …`) and silently no-op'd.
      logger.log('Updating .gitmodules')
      const gitmodulesPath = path.join(ROOT_DIR, '.gitmodules')
      const gitmodulesContent = await fs.readFile(gitmodulesPath, 'utf8')
      // sha256 was validated upfront before any write; reuse it.
      const versionLine = `# node-${newVersion} sha256:${nodeSha256}`
      const updated = gitmodulesContent.replace(
        /# node-\S+(?:\s+sha256:[0-9a-f]+)?\n(\[submodule "packages\/node-smol-builder\/upstream\/node"\])/,
        `${versionLine}\n$1`,
      )
      if (updated === gitmodulesContent) {
        logger.warn(
          'Version comment not found; .gitmodules was not modified. Verify format matches `# node-X.Y.Z` immediately before [submodule "packages/node-smol-builder/upstream/node"].',
        )
      }
      await fs.writeFile(gitmodulesPath, updated, 'utf8')

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
  } catch (e) {
    // Any failure after the fs.writeFile(gitmodulesPath) call above leaves
    // .gitmodules ahead of reality — submodule SHA not fetched, or git add
    // not staged. If we let step 3 rewrite patch metadata on top of that,
    // the repo is doubly inconsistent. Abort hard instead of warning.
    logger.fail(`Failed to update upstream: ${errorMessage(e)}`)
    process.exitCode = 1
    return
  }
  logger.log('')

  // 3. Update patch metadata
  logger.step('Updating patch metadata')
  const patchesDir = path.join(
    ROOT_DIR,
    'packages/node-smol-builder/patches/source-patched',
  )
  try {
    const files = await fs.readdir(patchesDir)
    const patchFiles = files
      .filter((f: string) => f.endsWith('.patch'))
      .map((f: string) => path.join(patchesDir, f))

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

main().catch((e: unknown) => {
  logger.fail(`Error: ${errorMessage(e)}`)

  process.exitCode = 1
})

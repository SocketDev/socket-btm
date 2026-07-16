/**
 * @file GitHub Releases API helpers for the node-smol binary release
 *   pipeline. Split out of release.mts to keep that file under the file-size
 *   soft cap — auth check, existence check, deletion, and release creation
 *   all talk to the same Octokit client against the same owner/repo.
 */

import { promises as fs } from 'node:fs'
import process from 'node:process'

import { Octokit } from 'octokit'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const OWNER = 'SocketDev'
const REPO = 'socket-btm'

/**
 * Check if GitHub API is authenticated.
 * Validates by attempting to get authenticated user.
 */
// oxlint-disable-next-line socket/sort-source-methods -- release script ordered as a top-down pipeline (gather artifacts → checksum → assemble notes → upload → publish); alphabetizing would scatter the flow.
export async function checkGitHubAuth() {
  try {
    const octokit = new Octokit({
      auth: process.env['GITHUB_TOKEN'],
    })
    await octokit.rest.users.getAuthenticated()
    return true
  } catch (e) {
    // Only 401/403 means "not authenticated" — surface other errors (5xx,
    // network drop) so callers don't downgrade to a non-auth code path.
    const status = e?.status
    if (status === 401 || status === 403) {
      return false
    }
    throw e
  }
}

/**
 * Check if release already exists.
 */
export async function releaseExists(tag) {
  try {
    const octokit = new Octokit({
      auth: process.env['GITHUB_TOKEN'],
    })
    await octokit.rest.repos.getReleaseByTag({
      owner: OWNER,
      repo: REPO,
      tag,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Delete existing release.
 */
// oxlint-disable-next-line socket/sort-source-methods -- release script ordered as a top-down pipeline (gather artifacts → checksum → assemble notes → upload → publish); alphabetizing would scatter the flow.
export async function deleteRelease(tag) {
  logger.log('')
  logger.log(`Deleting existing release: ${tag}`)
  const octokit = new Octokit({
    auth: process.env['GITHUB_TOKEN'],
  })

  // Get release by tag to get release ID.
  const { data: release } = await octokit.rest.repos.getReleaseByTag({
    owner: OWNER,
    repo: REPO,
    tag,
  })

  // Delete the release.
  await octokit.rest.repos.deleteRelease({
    owner: OWNER,
    release_id: release.id,
    repo: REPO,
  })
}

/**
 * Create GitHub release.
 */
// oxlint-disable-next-line socket/sort-source-methods -- release script ordered as a top-down pipeline (gather artifacts → checksum → assemble notes → upload → publish); alphabetizing would scatter the flow.
export async function createGitHubRelease(
  tag,
  archives,
  publish,
  packageName,
  version,
  dryRun,
) {
  logger.log('')
  logger.log(`Creating GitHub release: ${tag}`)

  // Build release notes.
  const notes = [
    `# ${packageName} ${version}`,
    '',
    'Optimized Node.js binaries with SEA support and automatic Brotli compression.',
    '',
    '## Platform Builds',
    '',
    ...archives.map(a => `- **${a.archiveName}** (${a.sizeMB} MB)`),
    '',
    '## Features',
    '',
    '- SEA (Single Executable Application) support enabled',
    '- Automatic Brotli compression for SEA blobs (70-80% reduction)',
    '- Self-extracting compressed binaries with smart caching',
    '- V8 Lite Mode for smaller binaries (prod builds)',
    '- Small ICU (English-only, supports Unicode escapes)',
    '',
    '## Checksums',
    '',
    ...archives.map(a => `\`\`\`\n${a.checksum}  ${a.archiveName}\n\`\`\``),
    '',
    '## Usage in socket-cli',
    '',
    '```bash',
    '# Download binary',
    `curl -L https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${packageName}-${version}-darwin-arm64.tar.gz | tar xz`,
    '',
    '# Verify checksum',
    'shasum -a 256 node',
    '',
    '# Use binary',
    './node --version',
    '```',
  ].join('\n')

  // Create release.
  if (dryRun) {
    logger.group('[DRY RUN] Would create release:')
    logger.log(`Tag: ${tag}`)
    logger.log(`Title: ${packageName} ${version}`)
    logger.log(`Draft: ${!publish}`)
    logger.log(`Assets: ${archives.length}`)
    logger.groupEnd()
    return
  }

  const octokit = new Octokit({
    auth: process.env['GITHUB_TOKEN'],
  })

  // GitHub Releases ship immutable (Sigstore attestation, GA 2025-10-28):
  // creating a release with draft:false starts the attestation flow before
  // assets are uploaded, racing the asset writes. The fleet pattern is
  // always create-as-draft, upload all assets, then promote.
  const { data: release } = await octokit.rest.repos.createRelease({
    body: notes,
    draft: true,
    name: `${packageName} ${version}`,
    owner: OWNER,
    repo: REPO,
    tag_name: tag,
  })

  logger.log(`Created draft release: ${release.html_url}`)

  // Upload assets.
  logger.group('Uploading assets…')
  for (let i = 0, { length } = archives; i < length; i += 1) {
    const archive = archives[i]
    logger.log(`Uploading ${archive.archiveName}...`)
    const data = await fs.readFile(archive.archivePath)

    await octokit.rest.repos.uploadReleaseAsset({
      data,
      headers: {
        'content-length': data.length,
        'content-type': 'application/octet-stream',
      },
      name: archive.archiveName,
      owner: OWNER,
      release_id: release.id,
      repo: REPO,
    })
  }
  logger.groupEnd()

  if (publish) {
    logger.log('Promoting draft to published release…')
    await octokit.rest.repos.updateRelease({
      draft: false,
      owner: OWNER,
      release_id: release.id,
      repo: REPO,
    })
    logger.log(`Published: ${release.html_url}`)
  }
}

#!/usr/bin/env node

/**
 * Validates Dockerfile.build export patterns to prevent Depot nesting issues.
 *
 * Issue: When using Depot with `outputs: type=local,dest=<path>`, copying to `/build`
 * creates nested `dest/build/build/*` structure instead of `dest/build/*`.
 *
 * Correct pattern: COPY --from=build <source> /
 * Incorrect pattern: COPY --from=build <source> /build
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from 'build-infra/lib/error-utils'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.join(__dirname, '..')

type DockerfileIssue = {
  content: string
  line: number
  message: string
  suggestion: string
}

type FileIssues = {
  issues: DockerfileIssue[]
  path: string
}

export async function findDockerfiles(): Promise<string[]> {
  const result = await spawn(
    'find',
    ['packages', '-name', 'Dockerfile.build', '-type', 'f'],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    },
  )

  if (result.code !== 0) {
    throw new Error(`Failed to find Dockerfiles: ${result.stderr}`)
  }

  return String(result.stdout)
    .trim()
    .split('\n')
    .filter((line: string) => line.length > 0)
    .map((line: string) => path.join(repoRoot, line))
}

export async function validateDockerfile(
  dockerfilePath: string,
): Promise<DockerfileIssue[]> {
  const content = await fs.readFile(dockerfilePath, 'utf8')
  const lines = content.split('\n')

  const issues: DockerfileIssue[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1

    // Check for anti-pattern: COPY --from=build ... /build
    // This causes Depot to create nested build/build/ directories
    if (line.match(/COPY\s+--from=\w+\s+.*\s+\/build\s*$/)) {
      issues.push({
        content: line.trim(),
        line: lineNum,
        message:
          'COPY destination should be "/" not "/build" to avoid Depot nesting',
        suggestion: line.replace(/\/build\s*$/, '/'),
      })
    }
  }

  return issues
}

async function main(): Promise<void> {
  try {
    logger.info('🔍 Validating Dockerfile.build export patterns...')
    logger.error('')

    const dockerfiles = await findDockerfiles()

    if (!dockerfiles.length) {
      logger.warn('No Dockerfile.build files found')
      return
    }

    logger.info(`Found ${dockerfiles.length} Dockerfile(s) to validate`)
    logger.error('')

    let totalIssues = 0
    const filesWithIssues: FileIssues[] = []

    for (let i = 0, { length } = dockerfiles; i < length; i += 1) {
      const dockerfilePath = dockerfiles[i]!
      const relativePath = path.relative(repoRoot, dockerfilePath)

      if (!existsSync(dockerfilePath)) {
        logger.warn(`Skipping missing file: ${relativePath}`)
        continue
      }

      const issues = await validateDockerfile(dockerfilePath)

      if (issues.length > 0) {
        filesWithIssues.push({ issues, path: relativePath })
        totalIssues += issues.length
      }
    }

    if (totalIssues === 0) {
      logger.success('All Dockerfiles have correct export patterns!')
      logger.error('')
      return
    }

    logger.error('')
    logger.fail(
      `Found ${totalIssues} issue(s) in ${filesWithIssues.length} file(s):`,
    )
    logger.error('')

    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
    for (const { issues, path: filePath } of filesWithIssues) {
      logger.error('')
      logger.info(`${filePath}:`)
      for (let i = 0, { length } = issues; i < length; i += 1) {
        const issue = issues[i]!
        logger.info(`  Line ${issue.line}: ${issue.message}`)
        logger.info(`    Current:  ${issue.content}`)
        logger.info(`    Expected: ${issue.suggestion.trim()}`)
      }
    }

    logger.error('')
    logger.info(
      '💡 Tip: Change COPY destination from "/build" to "/" in export stage',
    )
    logger.info(
      '   This prevents Depot from creating nested build/build/* directories',
    )
    logger.error('')

    process.exitCode = 1
  } catch (e) {
    logger.error('')
    logger.fail(`Validation failed: ${errorMessage(e)}`)
    if ((e as Error).stack) {
      logger.info((e as Error).stack as string)
    }
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error('Unexpected error:', e)
  process.exitCode = 1
})

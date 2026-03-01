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
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.join(__dirname, '..')

async function findDockerfiles() {
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

  return result.stdout
    .trim()
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => path.join(repoRoot, line))
}

async function validateDockerfile(dockerfilePath) {
  const content = await fs.promises.readFile(dockerfilePath, 'utf-8')
  const lines = content.split('\n')

  const issues = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Check for anti-pattern: COPY --from=build ... /build
    // This causes Depot to create nested build/build/ directories
    if (line.match(/COPY\s+--from=\w+\s+.*\s+\/build\s*$/)) {
      issues.push({
        line: lineNum,
        content: line.trim(),
        message:
          'COPY destination should be "/" not "/build" to avoid Depot nesting',
        suggestion: line.replace(/\/build\s*$/, '/'),
      })
    }
  }

  return issues
}

async function main() {
  try {
    logger.info('🔍 Validating Dockerfile.build export patterns...\n')

    const dockerfiles = await findDockerfiles()

    if (!dockerfiles.length) {
      logger.warn('No Dockerfile.build files found')
      return
    }

    logger.info(`Found ${dockerfiles.length} Dockerfile(s) to validate\n`)

    let totalIssues = 0
    const filesWithIssues = []

    for (const dockerfilePath of dockerfiles) {
      const relativePath = path.relative(repoRoot, dockerfilePath)

      if (!existsSync(dockerfilePath)) {
        logger.warn(`Skipping missing file: ${relativePath}`)
        continue
      }

      const issues = await validateDockerfile(dockerfilePath)

      if (issues.length > 0) {
        filesWithIssues.push({ path: relativePath, issues })
        totalIssues += issues.length
      }
    }

    if (totalIssues === 0) {
      logger.success('✅ All Dockerfiles have correct export patterns!\n')
      return
    }

    logger.fail(
      `\n❌ Found ${totalIssues} issue(s) in ${filesWithIssues.length} file(s):\n`,
    )

    for (const { issues, path: filePath } of filesWithIssues) {
      logger.info(`\n${filePath}:`)
      for (const issue of issues) {
        logger.info(`  Line ${issue.line}: ${issue.message}`)
        logger.info(`    Current:  ${issue.content}`)
        logger.info(`    Expected: ${issue.suggestion.trim()}`)
      }
    }

    logger.info(
      '\n💡 Tip: Change COPY destination from "/build" to "/" in export stage',
    )
    logger.info(
      '   This prevents Depot from creating nested build/build/* directories\n',
    )

    process.exitCode = 1
  } catch (error) {
    logger.fail(`\nValidation failed: ${error.message}`)
    if (error.stack) {
      logger.info(error.stack)
    }
    process.exitCode = 1
  }
}

main().catch(error => {
  logger.error('Unexpected error:', error)
  process.exitCode = 1
})

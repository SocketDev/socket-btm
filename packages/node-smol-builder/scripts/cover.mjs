/**
 * Cross-platform script to run code coverage for C packages
 * Works on macOS, Linux, and Windows (with MinGW/MSYS)
 *
 * Usage:
 *   node scripts/cover.mjs [package-name]
 *
 * Examples:
 *   node scripts/cover.mjs binject
 *   node scripts/cover.mjs binpress
 *   node scripts/cover.mjs binflate
 *   node scripts/cover.mjs all
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = path.resolve(__dirname, '../..')
const C_PACKAGES = ['binject', 'binpress', 'binflate']

async function runCommand(command, args, cwd) {
  logger.log('')
  logger.info(`Running: ${command} ${args.join(' ')}`)
  logger.substep(`Directory: ${cwd}`)
  logger.log('')

  const result = await spawn(command, args, {
    cwd,
    shell: os.platform() === 'win32',
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }
}

async function runCoverageForPackage(packageName) {
  const packagePath = path.join(PACKAGES_DIR, packageName)

  if (!existsSync(packagePath)) {
    logger.error(`Package not found: ${packagePath}`)
    return false
  }

  // Determine platform-specific Makefile.
  let makefileName = 'Makefile.macos'
  if (os.platform() === 'linux') {
    makefileName = 'Makefile.linux'
  } else if (os.platform() === 'win32') {
    makefileName = 'Makefile.windows'
  }

  const makefilePath = path.join(packagePath, makefileName)
  if (!existsSync(makefilePath)) {
    logger.warn(`No ${makefileName} found for ${packageName}, skipping`)
    return true
  }

  logger.log('')
  logger.step(`Running coverage for: ${packageName}`)

  try {
    await runCommand('make', ['-f', makefileName, 'cover'], packagePath)
    logger.success(`Coverage completed for ${packageName}`)
    return true
  } catch (error) {
    logger.error(
      `Coverage failed for ${packageName}: ${error?.message || 'Unknown error'}`,
    )
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  const target = args[0] || 'all'

  logger.log('')
  logger.step('C Package Coverage Runner')
  logger.substep(`Platform: ${os.platform()}`)
  logger.log('')

  let packagesToRun = []
  if (target === 'all') {
    packagesToRun = C_PACKAGES
  } else if (C_PACKAGES.includes(target)) {
    packagesToRun = [target]
  } else {
    logger.error(`Unknown package: ${target}`)
    logger.log('')
    logger.info(`Available packages: ${C_PACKAGES.join(', ')}`)
    logger.info(`Use 'all' to run coverage for all packages`)
    throw new Error(`Unknown package: ${target}`)
  }

  logger.info(`Packages to analyze: ${packagesToRun.join(', ')}`)

  const results = {
    passed: [],
    failed: [],
  }

  const coveragePromises = packagesToRun.map(async pkg => {
    const success = await runCoverageForPackage(pkg)
    return { pkg, success }
  })

  const coverageResults = await Promise.allSettled(coveragePromises)

  for (const result of coverageResults) {
    if (result.status === 'fulfilled') {
      const { pkg, success } = result.value
      if (success) {
        results.passed.push(pkg)
      } else {
        results.failed.push(pkg)
      }
    } else {
      // Promise rejected - count as failed but we don't have pkg info
      results.failed.push('unknown')
    }
  }

  // Summary
  logger.log('')
  logger.step('Coverage Summary')
  logger.success(`Passed: ${results.passed.length}/${packagesToRun.length}`)
  if (results.passed.length > 0) {
    for (const pkg of results.passed) {
      logger.substep(`${pkg}`)
    }
  }
  if (results.failed.length > 0) {
    logger.error(`Failed: ${results.failed.length}`)
    for (const pkg of results.failed) {
      logger.substep(`${pkg}`)
    }
    throw new Error(`Coverage failed for ${results.failed.length} package(s)`)
  }

  logger.log('')
  logger.success('All coverage tests completed successfully!')
  logger.log('')
}

main().catch(error => {
  logger.log('')
  logger.error(`Fatal error: ${error?.message || 'Unknown error'}`)
  throw error
})

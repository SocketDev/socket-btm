/**
 * Cross-platform script to run code coverage for C packages
 * Works on macOS, Linux, and Windows (with MinGW/MSYS)
 *
 * Usage:
 *   node run-coverage.js [package-name]
 *
 * Examples:
 *   node run-coverage.js binject
 *   node run-coverage.js binpress
 *   node run-coverage.js binflate
 *   node run-coverage.js all
 */

const fs = require('node:fs')
const path = require('node:path')

const { joinAnd } = require('@socketsecurity/lib')
const { getDefaultLogger } = require('@socketsecurity/lib/logger')
const { spawn } = require('@socketsecurity/lib/spawn')
const process = require('node:process')


const logger = getDefaultLogger()
const PACKAGES_DIR = path.resolve(__dirname, '../..')
const C_PACKAGES = ['binject', 'binpress', 'binflate']
const WIN32 = process.platform === 'win32'

async function runCommand(command, args, cwd) {
  logger.info(`Running: ${command} ${args.join(' ')}`)
  logger.info(`Directory: ${cwd}`)
  logger.info('')

  const result = await spawn(command, args, {
    cwd,
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code === 0) {
    return
  }
  throw new Error(`Command failed with exit code ${result.code}`)
}

async function runCoverageForPackage(packageName) {
  const packagePath = path.join(PACKAGES_DIR, packageName)

  if (!fs.existsSync(packagePath)) {
    logger.error(`Package not found: ${packagePath}`)
    return false
  }

  // Determine platform-specific Makefile.
  let makefileName = 'Makefile.macos'
  if (process.platform === 'linux') {
    makefileName = 'Makefile.linux'
  } else if (process.platform === 'win32') {
    makefileName = 'Makefile.win'
  }

  const makefilePath = path.join(packagePath, makefileName)
  if (!fs.existsSync(makefilePath)) {
    logger.warn(`No ${makefileName} found for ${packageName}, skipping`)
    return true
  }

  logger.info('')
  logger.info('='.repeat(60))
  logger.info(`Running coverage for: ${packageName}`)
  logger.info('='.repeat(60))

  try {
    await runCommand('make', ['-f', makefileName, 'cover'], packagePath)
    logger.success(`Coverage completed for ${packageName}`)
    return true
  } catch (error) {
    logger.error(`Coverage failed for ${packageName}: ${error.message}`)
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  const target = args[0] || 'all'

  logger.info('')
  logger.info('C Package Coverage Runner')
  logger.info(`Platform: ${process.platform}`)
  logger.info('')

  let packagesToRun = []
  if (target === 'all') {
    packagesToRun = C_PACKAGES
  } else if (C_PACKAGES.includes(target)) {
    packagesToRun = [target]
  } else {
    logger.error(`Unknown package: ${target}`)
    logger.warn(`Available packages: ${joinAnd(C_PACKAGES)}`)
    logger.warn(`Use 'all' to run coverage for all packages`)
    throw new Error(`Unknown package: ${target}`)
  }

  logger.info(`Packages to analyze: ${joinAnd(packagesToRun)}`)

  const results = {
    failed: [],
    passed: [],
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
  logger.info('')
  logger.info('='.repeat(60))
  logger.info('Coverage Summary')
  logger.info('='.repeat(60))
  logger.info(`Passed: ${results.passed.length}/${packagesToRun.length}`)
  if (results.passed.length > 0) {
    results.passed.forEach(pkg => logger.success(`  ${pkg}`))
  }
  if (results.failed.length > 0) {
    logger.error(`Failed: ${results.failed.length}`)
    results.failed.forEach(pkg => logger.error(`  ${pkg}`))
    throw new Error(`Coverage failed for ${results.failed.length} package(s)`)
  }

  logger.success('All coverage tests completed successfully!')
  logger.info('')
}

main().catch(error => {
  logger.error(`Fatal error: ${error.message}`)
  throw error
})

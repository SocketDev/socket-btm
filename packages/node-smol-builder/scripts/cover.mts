/**
 * Combined coverage runner for node-smol-builder.
 * Works on macOS, Linux, and Windows (with MinGW/MSYS).
 *
 * Runs coverage for both:
 *   - C packages (binject, binpress, binflate) via their platform Makefiles
 *   - node-smol-builder's own JS tests via vitest
 *
 * Usage:
 *   node scripts/cover.mts              # both C packages and vitest
 *   node scripts/cover.mts c            # only C packages
 *   node scripts/cover.mts vitest       # only vitest
 *   node scripts/cover.mts binject      # only the named C package
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = path.resolve(__dirname, '..')
const PACKAGES_DIR = path.resolve(__dirname, '../..')
const C_PACKAGES = ['binject', 'binpress', 'binflate']

async function runCommand(command, args, cwd) {
  logger.log('')
  logger.info(`Running: ${command} ${args.join(' ')}`)
  logger.substep(`Directory: ${cwd}`)
  logger.log('')

  const result = await spawn(command, args, {
    cwd,
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }
}

async function runCCoverageForPackage(packageName) {
  const packagePath = path.join(PACKAGES_DIR, packageName)

  if (!existsSync(packagePath)) {
    logger.error(`Package not found: ${packagePath}`)
    return false
  }

  let makefileName = 'Makefile.macos'
  if (os.platform() === 'linux') {
    makefileName = 'Makefile.linux'
  } else if (os.platform() === 'win32') {
    makefileName = 'Makefile.win'
  }

  let makefilePath = path.join(packagePath, 'test', 'coverage', makefileName)
  if (!existsSync(makefilePath)) {
    makefilePath = path.join(packagePath, makefileName)
  }
  if (!existsSync(makefilePath)) {
    logger.warn(`No ${makefileName} found for ${packageName}, skipping`)
    return true
  }

  logger.log('')
  logger.step(`Running C coverage for: ${packageName}`)

  try {
    await runCommand('make', ['-f', makefileName, 'cover'], packagePath)
    logger.success(`C coverage completed for ${packageName}`)
    return true
  } catch (error) {
    logger.error(
      `C coverage failed for ${packageName}: ${error?.message || 'Unknown error'}`,
    )
    return false
  }
}

async function runVitestCoverage() {
  logger.log('')
  logger.step('Running vitest coverage for node-smol-builder')
  try {
    await runCommand('pnpm', ['exec', 'vitest', 'run', '--coverage'], PACKAGE_DIR)
    logger.success('vitest coverage completed')
    return true
  } catch (error) {
    logger.error(
      `vitest coverage failed: ${error?.message || 'Unknown error'}`,
    )
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  const target = args[0]

  logger.log('')
  logger.step('node-smol-builder Coverage Runner')
  logger.substep(`Platform: ${os.platform()}`)
  logger.log('')

  const runC = target === undefined || target === 'c' || C_PACKAGES.includes(target)
  const runVitest = target === undefined || target === 'vitest'

  if (!runC && !runVitest) {
    logger.error(`Unknown target: ${target}`)
    logger.log('')
    logger.info(`Available: (none), c, vitest, ${C_PACKAGES.join(', ')}`)
    throw new Error(`Unknown target: ${target}`)
  }

  const cPackages = C_PACKAGES.includes(target) ? [target] : C_PACKAGES
  const results = {
    failed: [],
    passed: [],
  }

  if (runC) {
    logger.info(`C packages to analyze: ${cPackages.join(', ')}`)
    const cPromises = cPackages.map(async pkg => {
      const success = await runCCoverageForPackage(pkg)
      return { name: pkg, success }
    })
    const cResults = await Promise.allSettled(cPromises)
    for (const result of cResults) {
      if (result.status === 'fulfilled') {
        const { name, success } = result.value
        if (success) {
          results.passed.push(name)
        } else {
          results.failed.push(name)
        }
      } else {
        results.failed.push('unknown')
      }
    }
  }

  if (runVitest) {
    const success = await runVitestCoverage()
    if (success) {
      results.passed.push('vitest')
    } else {
      results.failed.push('vitest')
    }
  }

  logger.log('')
  logger.step('Coverage Summary')
  logger.success(`Passed: ${results.passed.length}`)
  if (results.passed.length > 0) {
    for (const name of results.passed) {
      logger.substep(`${name}`)
    }
  }
  if (results.failed.length > 0) {
    logger.error(`Failed: ${results.failed.length}`)
    for (const name of results.failed) {
      logger.substep(`${name}`)
    }
    throw new Error(`Coverage failed for ${results.failed.length} run(s)`)
  }

  logger.log('')
  logger.success('All coverage runs completed successfully!')
  logger.log('')
}

main().catch(error => {
  logger.log('')
  logger.error(`Fatal error: ${error?.message || 'Unknown error'}`)
  throw error
})

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
import { platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = path.resolve(__dirname, '../..')
const C_PACKAGES = ['binject', 'binpress', 'binflate']

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
}

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

async function runCommand(command, args, cwd) {
  log(
    `\n${colors.bright}${colors.cyan}Running: ${command} ${args.join(' ')}${colors.reset}`,
  )
  log(`${colors.cyan}Directory: ${cwd}${colors.reset}\n`)

  const result = await spawn(command, args, {
    cwd,
    shell: platform() === 'win32',
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }
}

async function runCoverageForPackage(packageName) {
  const packagePath = path.join(PACKAGES_DIR, packageName)

  if (!existsSync(packagePath)) {
    log(`Package not found: ${packagePath}`, colors.red)
    return false
  }

  // Determine platform-specific Makefile.
  let makefileName = 'Makefile.macos'
  if (platform() === 'linux') {
    makefileName = 'Makefile.linux'
  } else if (platform() === 'win32') {
    makefileName = 'Makefile.windows'
  }

  const makefilePath = path.join(packagePath, makefileName)
  if (!existsSync(makefilePath)) {
    log(`No ${makefileName} found for ${packageName}, skipping`, colors.yellow)
    return true
  }

  log(`\n${'='.repeat(60)}`, colors.bright)
  log(`Running coverage for: ${packageName}`, colors.bright + colors.cyan)
  log(`${'='.repeat(60)}`, colors.bright)

  try {
    await runCommand('make', ['-f', makefileName, 'cover'], packagePath)
    log(`✓ Coverage completed for ${packageName}`, colors.green)
    return true
  } catch (error) {
    log(`✗ Coverage failed for ${packageName}: ${error.message}`, colors.red)
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  const target = args[0] || 'all'

  log(
    `\n${colors.bright}${colors.cyan}C Package Coverage Runner${colors.reset}`,
  )
  log(`${colors.cyan}Platform: ${platform()}${colors.reset}\n`)

  let packagesToRun = []
  if (target === 'all') {
    packagesToRun = C_PACKAGES
  } else if (C_PACKAGES.includes(target)) {
    packagesToRun = [target]
  } else {
    log(`Unknown package: ${target}`, colors.red)
    log(`\nAvailable packages: ${C_PACKAGES.join(', ')}`, colors.yellow)
    log(`Use 'all' to run coverage for all packages`, colors.yellow)
    throw new Error(`Unknown package: ${target}`)
  }

  log(`Packages to analyze: ${packagesToRun.join(', ')}`, colors.cyan)

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
  log(`\n${'='.repeat(60)}`, colors.bright)
  log('Coverage Summary', colors.bright + colors.cyan)
  log(`${'='.repeat(60)}`, colors.bright)
  log(`Passed: ${results.passed.length}/${packagesToRun.length}`, colors.green)
  if (results.passed.length > 0) {
    results.passed.forEach(pkg => log(`  ✓ ${pkg}`, colors.green))
  }
  if (results.failed.length > 0) {
    log(`Failed: ${results.failed.length}`, colors.red)
    results.failed.forEach(pkg => log(`  ✗ ${pkg}`, colors.red))
    throw new Error(`Coverage failed for ${results.failed.length} package(s)`)
  }

  log(
    `\n${colors.green}All coverage tests completed successfully!${colors.reset}\n`,
  )
}

main().catch(error => {
  log(`\nFatal error: ${error.message}`, colors.red)
  process.exit(1)
})

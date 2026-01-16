#!/usr/bin/env node
/**
 * Setup Docker builder images for local builds.
 *
 * This script initializes Docker images for building Linux targets locally.
 * On first run, it will:
 * 1. Check Docker is installed and running
 * 2. Setup Docker buildx for multi-platform builds
 * 3. Setup QEMU emulation for cross-architecture builds
 * 4. Build all Linux builder images
 *
 * Usage:
 *   node scripts/setup-docker-builds.mjs [options]
 *
 * Options:
 *   --force          Force rebuild of all images
 *   --targets=...    Comma-separated list of targets to build
 *   --skip-qemu      Skip QEMU emulation setup
 *   --help           Show help
 *
 * Examples:
 *   # Setup all Linux targets
 *   node scripts/setup-docker-builds.mjs
 *
 *   # Force rebuild specific targets
 *   node scripts/setup-docker-builds.mjs --force --targets=linux-x64-glibc,linux-x64-musl
 */

import { printError, printInfo, printSuccess } from '../lib/build-output.mjs'
import {
  ALL_TARGETS,
  getBuildStrategy,
  getHostInfo,
  LINUX_TARGETS,
  setupDockerBuilds,
} from '../lib/local-build-setup.mjs'

function printHelp() {
  console.log(`
Setup Docker builder images for local builds.

Usage:
  node scripts/setup-docker-builds.mjs [options]

Options:
  --force          Force rebuild of all images (even if they exist)
  --targets=...    Comma-separated list of targets to build
                   Available: ${LINUX_TARGETS.join(', ')}
  --skip-qemu      Skip QEMU emulation setup (disables cross-arch builds)
  --status         Show current status of builder images
  --help           Show this help message

Examples:
  # Setup all Linux builder images
  node scripts/setup-docker-builds.mjs

  # Rebuild specific targets
  node scripts/setup-docker-builds.mjs --force --targets=linux-x64-glibc

  # Setup without cross-arch support
  node scripts/setup-docker-builds.mjs --skip-qemu
`)
}

function parseArgs(args) {
  const options = {
    force: false,
    targets: LINUX_TARGETS,
    skipQemu: false,
    status: false,
    help: false,
  }

  for (const arg of args) {
    if (arg === '--force') {
      options.force = true
    } else if (arg === '--skip-qemu') {
      options.skipQemu = true
    } else if (arg === '--status') {
      options.status = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg.startsWith('--targets=')) {
      const targetsStr = arg.slice('--targets='.length)
      options.targets = targetsStr.split(',').map(t => t.trim())

      // Validate targets
      for (const target of options.targets) {
        if (!LINUX_TARGETS.includes(target)) {
          console.error(`Unknown target: ${target}`)
          console.error(`Available targets: ${LINUX_TARGETS.join(', ')}`)
          process.exitCode = 1
          return
        }
      }
    }
  }

  return options
}

async function showStatus() {
  const { hasBuilderImage } = await import('../lib/local-build-setup.mjs')
  const { arch, platform, target: hostTarget } = getHostInfo()

  console.log('\n=== Docker Build Status ===\n')
  console.log(`Host: ${platform}-${arch}`)
  console.log(`Native target: ${hostTarget || 'unknown'}\n`)

  console.log('Target                 | Strategy | Image Status')
  console.log('-----------------------|----------|-------------')

  for (const target of ALL_TARGETS) {
    const strategy = getBuildStrategy(target)
    let imageStatus = '-'

    if (LINUX_TARGETS.includes(target)) {
      const hasImage = await hasBuilderImage(target)
      imageStatus = hasImage ? 'ready' : 'not built'
    }

    const targetPadded = target.padEnd(22)
    const strategyPadded = strategy.padEnd(8)
    console.log(`${targetPadded} | ${strategyPadded} | ${imageStatus}`)
  }

  console.log('')
}

async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  if (!options) {
    process.exitCode = 1
    return
  }

  if (options.help) {
    printHelp()
    return
  }

  if (options.status) {
    await showStatus()
    return
  }

  printInfo('Socket BTM Docker Build Setup')
  printInfo('==============================\n')

  const { ok, results } = await setupDockerBuilds({
    targets: options.targets,
    force: options.force,
    skipQemu: options.skipQemu,
  })

  // Print summary
  console.log('\n=== Summary ===\n')

  for (const [target, success] of Object.entries(results)) {
    const status = success ? '\u2713' : '\u2717'
    console.log(`  ${status} ${target}`)
  }

  console.log('')

  if (ok) {
    printSuccess('Docker build environment is ready!')
    printInfo(
      'Run builds with: pnpm --filter <package> run build --target=<target>',
    )
  } else {
    printError('Some images failed to build. Check the output above.')
    process.exitCode = 1
  }
}

main().catch(error => {
  printError(`Setup failed: ${error.message}`)
  console.error(error)
  process.exitCode = 1
})

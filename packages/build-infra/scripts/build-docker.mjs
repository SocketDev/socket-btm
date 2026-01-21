#!/usr/bin/env node
/**
 * Build a package for a specific target using Docker.
 *
 * Usage:
 *   node scripts/build-docker.mjs --package=<name> --target=<target> [options]
 *
 * Options:
 *   --package=...   Package to build (required)
 *   --target=...    Build target (required, linux-x64 defaults to linux-x64-glibc)
 *   --output=...    Output directory (default: ./build/docker/<target>)
 *   --mode=...      Build mode: 'dev' or 'prod' (default: prod)
 *   --force         Force rebuild
 *   --help          Show help
 *
 * Examples:
 *   node scripts/build-docker.mjs --package=binpress --target=linux-x64
 *   node scripts/build-docker.mjs --package=binpress --target=linux-arm64-musl --mode=dev
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { printError, printInfo, printSuccess } from '../lib/build-output.mjs'
import { buildForTarget, getAllTargets } from '../lib/docker-builder.mjs'
import { hasBuilderImage, LINUX_TARGETS } from '../lib/local-build-setup.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..')

/**
 * Normalize target name - linux-x64 becomes linux-x64-glibc (default libc).
 *
 * @param {string} target - Input target
 * @returns {string} Normalized target
 */
function normalizeTarget(target) {
  // If target is linux-x64 or linux-arm64 without libc suffix, default to glibc
  if (target === 'linux-x64') {
    return 'linux-x64-glibc'
  }
  if (target === 'linux-arm64') {
    return 'linux-arm64-glibc'
  }
  return target
}

function printHelp() {
  const targets = getAllTargets()
  console.log(`
Build a package for a specific target.

Usage:
  node scripts/build-docker.mjs --package=<name> --target=<target> [options]

Options:
  --package=...   Package to build (required)
  --target=...    Build target (required)
                  Available: ${targets.join(', ')}
                  Shorthand: linux-x64 → linux-x64-glibc, linux-arm64 → linux-arm64-glibc
  --output=...    Output directory (default: ./build/docker/<target>)
  --mode=...      Build mode: 'dev' or 'prod' (default: prod)
  --force         Force rebuild even if output exists
  --help          Show this help message

Examples:
  # Build binpress for linux-x64-glibc (shorthand)
  node scripts/build-docker.mjs --package=binpress --target=linux-x64

  # Build for arm64 musl in dev mode
  node scripts/build-docker.mjs --package=binpress --target=linux-arm64-musl --mode=dev

  # Force rebuild with custom output
  node scripts/build-docker.mjs --package=binpress --target=linux-x64 --force --output=./out
`)
}

function parseArgs(args) {
  const options = {
    buildMode: 'prod',
    force: false,
    help: false,
    outputDir: undefined,
    packageName: undefined,
    target: undefined,
  }

  for (const arg of args) {
    if (arg === '--force') {
      options.force = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg.startsWith('--package=')) {
      options.packageName = arg.slice('--package='.length)
    } else if (arg.startsWith('--target=')) {
      options.target = arg.slice('--target='.length)
    } else if (arg.startsWith('--output=')) {
      options.outputDir = arg.slice('--output='.length)
    } else if (arg.startsWith('--mode=')) {
      options.buildMode = arg.slice('--mode='.length)
    }
  }

  return options
}

async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  if (options.help) {
    printHelp()
    return
  }

  // Validate required options
  if (!options.packageName) {
    printError('Missing required option: --package=<name>')
    printHelp()
    process.exitCode = 1
    return
  }

  if (!options.target) {
    printError('Missing required option: --target=<target>')
    printHelp()
    process.exitCode = 1
    return
  }

  // Normalize target (linux-x64 -> linux-x64-glibc)
  options.target = normalizeTarget(options.target)

  // Validate target
  const allTargets = getAllTargets()
  if (!allTargets.includes(options.target)) {
    printError(`Unknown target: ${options.target}`)
    printError(`Available targets: ${allTargets.join(', ')}`)
    process.exitCode = 1
    return
  }

  // Validate build mode
  if (!['dev', 'prod'].includes(options.buildMode)) {
    printError(`Invalid build mode: ${options.buildMode}`)
    printError('Available modes: dev, prod')
    process.exitCode = 1
    return
  }

  // Check if Docker image exists for Linux targets
  if (LINUX_TARGETS.includes(options.target)) {
    if (!(await hasBuilderImage(options.target))) {
      printError(`Builder image for ${options.target} not found.`)
      printInfo('Run setup first: pnpm --filter build-infra run setup:docker')
      process.exitCode = 1
      return
    }
  }

  // Set default output directory
  const outputDir =
    options.outputDir ||
    path.join(WORKSPACE_ROOT, 'build', 'docker', options.target)

  printInfo(`Building ${options.packageName} for ${options.target}`)
  printInfo(`Output: ${outputDir}`)
  printInfo(`Mode: ${options.buildMode}`)
  console.log('')

  const result = await buildForTarget({
    buildMode: options.buildMode,
    force: options.force,
    outputDir,
    packageName: options.packageName,
    target: options.target,
    // Native build and download functions would be provided by the package
    // For now, we only support Docker builds from this script
    download: async () => {
      printError('Download not implemented in this script')
      return { ok: false }
    },
    nativeBuild: async () => {
      printError('Native build not implemented in this script')
      printInfo('Use the package build script directly for native builds')
      return { ok: false }
    },
  })

  console.log('')

  if (result.ok) {
    printSuccess(`Build completed (strategy: ${result.strategy})`)
    if (result.artifactPath) {
      printInfo(`Artifact: ${result.artifactPath}`)
    }
  } else {
    printError(`Build failed (strategy: ${result.strategy})`)
    process.exitCode = 1
  }
}

main().catch(error => {
  printError(`Build failed: ${error.message}`)
  console.error(error)
  process.exitCode = 1
})

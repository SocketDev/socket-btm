#!/usr/bin/env node

/**
 * Startup Performance Benchmark
 *
 * Measures cold-start performance of node-smol SEA binaries.
 * Similar to https://github.com/yyx990803/bun-vs-node-sea-startup
 *
 * Usage:
 *   node scripts/benchmark-startup.mjs ./my-app [--runs 30] [--warmup 0]
 *   node scripts/benchmark-startup.mjs ./app1 ./app2 --runs 50
 *
 * Requires hyperfine: https://github.com/sharkdp/hyperfine
 *   macOS: brew install hyperfine
 *   Linux: apt install hyperfine / snap install hyperfine
 *   Windows: choco install hyperfine / scoop install hyperfine
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const args = process.argv.slice(2)

// Parse arguments
const binaries = []
let runs = 30
let warmup = 0

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--runs' || arg === '-r') {
    runs = Number.parseInt(args[++i], 10)
  } else if (arg === '--warmup' || arg === '-w') {
    warmup = Number.parseInt(args[++i], 10)
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Startup Performance Benchmark

Usage:
  node scripts/benchmark-startup.mjs <binary1> [binary2...] [options]

Options:
  --runs, -r <number>    Number of benchmark runs (default: 30)
  --warmup, -w <number>  Number of warmup runs (default: 0)
  --help, -h             Show this help

Examples:
  node scripts/benchmark-startup.mjs ./my-app
  node scripts/benchmark-startup.mjs ./app-with-cache ./app-no-cache --runs 50
  node scripts/benchmark-startup.mjs ./my-app --warmup 3 --runs 100

Requires hyperfine: https://github.com/sharkdp/hyperfine
  macOS:   brew install hyperfine
  Linux:   apt install hyperfine
  Windows: choco install hyperfine
`)
    process.exitCode = 0
    break
  } else {
    binaries.push(arg)
  }
}

async function main() {
  // Validate inputs
  if (binaries.length === 0) {
    throw new Error(
      'No binaries specified\nUsage: node scripts/benchmark-startup.mjs <binary1> [binary2...] [options]\nRun with --help for more information',
    )
  }

  for (const binary of binaries) {
    if (!existsSync(binary)) {
      throw new Error(`Binary not found: ${binary}`)
    }
  }

  // Check if hyperfine is installed
  try {
    await spawn('hyperfine', ['--version'], { stdio: 'ignore' })
  } catch {
    throw new Error(
      'hyperfine is not installed\n\nInstall hyperfine:\n  macOS:   brew install hyperfine\n  Linux:   apt install hyperfine\n  Windows: choco install hyperfine\n\nSee: https://github.com/sharkdp/hyperfine',
    )
  }

  // Build hyperfine command
  const hyperfineArgs = [
    '--runs',
    runs.toString(),
    '--warmup',
    warmup.toString(),
    '--export-markdown',
    'benchmark-results.md',
    '--export-json',
    'benchmark-results.json',
  ]

  // Add each binary as a benchmark command
  for (const binary of binaries) {
    const name = path.basename(binary)
    hyperfineArgs.push('--command-name', name)
    hyperfineArgs.push(`${binary} --version`)
  }

  // Run benchmark
  logger.info('Running startup benchmark...')
  logger.info(`  Runs: ${runs}`)
  logger.info(`  Warmup: ${warmup}`)
  logger.info(`  Binaries: ${binaries.map(b => path.basename(b)).join(', ')}`)
  logger.info('')

  const result = await spawn('hyperfine', hyperfineArgs, {
    stdio: 'inherit',
  })

  if (result.code === 0) {
    logger.info('')
    logger.success('Benchmark complete!')
    logger.info('')
    logger.info('Results saved to:')
    logger.info('  - benchmark-results.md (Markdown table)')
    logger.info('  - benchmark-results.json (JSON data)')
  } else {
    throw new Error(`Benchmark failed with exit code ${result.code}`)
  }
}

main()

#!/usr/bin/env node
/**
 * Unified smoke test utility for binary tools.
 *
 * For C binaries (binpress, binflate, binject): runs --version check
 * For Node.js binaries (node-smol): runs comprehensive functional tests
 *
 * Provides automatic testing with fallback for cross-compiled binaries:
 * 1. Try native execution
 * 2. On cross-compile error, try QEMU/Docker emulation if available
 * 3. Fall back to static verification (architecture, format, linking)
 *
 * Usage:
 *   node smoke-test-binary.mjs <binary-path> [--arch arm64|x64] [--musl]
 *
 * Examples:
 *   node smoke-test-binary.mjs out/binpress
 *   node smoke-test-binary.mjs out/binpress --arch arm64
 *   node smoke-test-binary.mjs out/node-smol --musl
 */

import path from 'node:path'

import { smokeTestBinary } from '../lib/build-helpers.mjs'

// Parse arguments
const args = process.argv.slice(2)
if (args.length < 1) {
  console.error(
    'Usage: smoke-test-binary <binary-path> [--arch arm64|x64] [--musl]',
  )
  process.exit(1)
}

const binaryPath = args[0]
const options = {}

// Parse optional flags
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--arch' && i + 1 < args.length) {
    options.expectedArch = args[i + 1]
    i++
  } else if (args[i] === '--musl') {
    options.expectStatic = true
    options.isMusl = true
  }
}

// Determine test type based on binary name
const binaryName = path.basename(binaryPath).toLowerCase()
const isNodeBinary = binaryName.startsWith('node')

// For C binaries (binpress, binflate, binject), just test --version
// For Node.js binaries (node-smol), run comprehensive tests
const testArgs = isNodeBinary ? null : ['--version']

const passed = await smokeTestBinary(binaryPath, testArgs, options)
process.exit(passed ? 0 : 1)

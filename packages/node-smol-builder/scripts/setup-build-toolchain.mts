#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for node-smol-builder
 *
 * Installs required system dependencies:
 * - Linux: gcc, make, libssl-dev, rust (rustc >= 1.82, cargo >= 1.82)
 * - macOS: clang (Xcode), make, openssl@3, rust (rustc >= 1.82, cargo >= 1.82)
 * - Windows: mingw-w64, make, rust (rustc >= 1.82, cargo >= 1.82)
 *
 * Rust is required by Node 26+ to link the temporal_rs Rust crate that
 * backs the Temporal API. configure.py asserts rustc/cargo >= 1.82 with
 * LLVM >= 19. See socket-registry/external-tools.json `rust` entry for
 * the canonical pin + rationale.
 *
 * After running this script, also verify Rust is on PATH:
 *
 *   rustc --version    # should print rustc 1.82+ ...
 *   cargo --version    # should print cargo 1.82+ ...
 *
 * If Rust isn't installed, see https://rustup.rs (curl one-liner) or
 * `brew install rust` / `apt install rustc cargo` / `choco install rust`.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  isCI,
  runSetupToolchain,
} from 'build-infra/lib/setup-build-toolchain'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

await runSetupToolchain({
  packageName: 'node-smol-builder',
  packageRoot,
  tools: {
    darwin: ['clang', 'make', 'openssl@3', 'rust'],
    linux: ['gcc', 'make', 'libssl-dev', 'rust'],
    win32: ['mingw-w64', 'make', 'rust'],
  },
})

// Post-install: verify rustc/cargo meet Node 26's >= 1.82 minimum. The
// `tools` array above only ensures *some* Rust is installed; the
// version check below ensures it's recent enough for Temporal.
function checkRustVersion(bin: string, minMajor: number, minMinor: number): void {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
  if (r.status !== 0) {
    logger.error(
      `× ${bin} not found on PATH. Install via https://rustup.rs or your platform's package manager.`,
    )
    process.exit(1)
  }
  // `rustc 1.82.0 (1234abcd5 2025-10-14)` → ['1', '82', '0']
  const m = /^[a-z]+\s+(\d+)\.(\d+)\.(\d+)/.exec(r.stdout)
  if (!m) {
    logger.error(`× could not parse ${bin} version: ${r.stdout.trim()}`)
    process.exit(1)
  }
  const [, majStr, minStr] = m
  const maj = Number(majStr)
  const min = Number(minStr)
  if (maj < minMajor || (maj === minMajor && min < minMinor)) {
    logger.error(
      `× ${bin} version ${maj}.${min} is below the Node 26 Temporal minimum ` +
        `(${minMajor}.${minMinor}). Run \`rustup update stable\` (rustup) or ` +
        `upgrade via your platform's package manager.`,
    )
    process.exit(1)
  }
  logger.log(`✓ ${bin} ${maj}.${min} (>= ${minMajor}.${minMinor})`)
}

// Skip the rustc/cargo version check in CI: workflows install Rust
// via dtolnay/rust-toolchain BEFORE the build step, but Docker base
// images for sibling builders (curl, lief, stubs, etc.) install
// node-smol-builder as a workspace dep without needing Rust at
// install time. The version check is for local-dev sanity and would
// otherwise abort the install of every CI Docker layer.
if (!isCI()) {
  checkRustVersion('rustc', 1, 82)
  checkRustVersion('cargo', 1, 82)
}

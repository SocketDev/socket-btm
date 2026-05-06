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

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { runSetupToolchain } from 'build-infra/lib/setup-build-toolchain'

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

// Detect rustc/cargo and report version. Soft warning — never aborts.
// Mirrors the napi-go-infra pattern: postinstall is informational, not
// gating. Workflows install rustup before invoking the actual node-smol
// build; sibling-builder Docker bases (curl, lief, stubs, …) install
// node-smol-builder as a workspace dep without needing Rust at install
// time, so a missing toolchain here is expected and benign.
async function reportToolVersion(
  bin: string,
  minMajor: number,
  minMinor: number,
): Promise<void> {
  try {
    const result = await spawn(bin, ['--version'], {
      shell: WIN32,
      stdio: 'pipe',
    })
    const exit = result.code ?? 0
    if (exit !== 0) {
      logger.warn(`${bin} not found. Install via https://rustup.rs`)
      return
    }
    const out = result.stdout?.toString() ?? ''
    // `rustc 1.82.0 (1234abcd5 2025-10-14)` → ['1', '82', '0']
    const m = /^[a-z]+\s+(\d+)\.(\d+)\.(\d+)/.exec(out)
    if (!m) {
      logger.warn(`${bin} version unparseable: ${out.trim()}`)
      return
    }
    const [, majStr, minStr] = m
    const maj = Number(majStr)
    const min = Number(minStr)
    if (maj < minMajor || (maj === minMajor && min < minMinor)) {
      logger.warn(
        `${bin} ${maj}.${min} is below the Node 26 Temporal minimum ` +
          `(${minMajor}.${minMinor}). Run \`rustup update stable\`.`,
      )
      return
    }
    logger.log(`✓ ${bin} ${maj}.${min} (>= ${minMajor}.${minMinor})`)
  } catch {
    logger.warn(`${bin} not found. Install via https://rustup.rs`)
  }
}

await reportToolVersion('rustc', 1, 82)
await reportToolVersion('cargo', 1, 82)

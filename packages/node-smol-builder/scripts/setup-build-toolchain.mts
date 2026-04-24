#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for node-smol-builder
 *
 * Installs required system dependencies:
 * - Linux: gcc, make, libssl-dev
 * - macOS: clang (Xcode), make, openssl@3
 * - Windows: mingw-w64, make
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runSetupToolchain } from 'build-infra/lib/setup-build-toolchain'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

await runSetupToolchain({
  packageName: 'node-smol-builder',
  packageRoot,
  tools: {
    darwin: ['clang', 'make', 'openssl@3'],
    linux: ['gcc', 'make', 'libssl-dev'],
    win32: ['mingw-w64', 'make'],
  },
})

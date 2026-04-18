#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for binpress
 *
 * Installs required system dependencies:
 * - Linux: gcc, make (zstd compiled from submodule)
 * - macOS: clang (Xcode), make (system Compression framework)
 * - Windows: mingw-w64, make (Cabinet API)
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runSetupToolchain } from 'build-infra/lib/setup-build-toolchain'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

await runSetupToolchain({
  packageName: 'binpress',
  packageRoot,
  tools: {
    darwin: ['clang', 'make'],
    darwinNote:
      'Note: Compression via system Compression framework (no extra deps)',
    linux: ['gcc', 'make'],
    linuxNote: 'Note: zstd compiled from bundled sources',
    win32: ['mingw-w64', 'make'],
    win32Note: 'Note: Compression via Cabinet API (no extra deps)',
  },
})

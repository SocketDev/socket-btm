#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for binject
 *
 * Installs required system dependencies:
 * - Linux: gcc, make, cmake (LIEF library)
 * - macOS: clang (Xcode), cmake, make (LIEF library, system Compression framework)
 * - Windows: mingw-w64 (gcc/g++), cmake, make (LIEF library, Cabinet API)
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runSetupToolchain } from 'build-infra/lib/setup-build-toolchain'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

await runSetupToolchain({
  packageName: 'binject',
  packageRoot,
  tools: {
    darwin: ['clang', 'cmake', 'make'],
    darwinNote:
      'Note: Compression via system Compression framework (no extra deps)',
    linux: ['gcc', 'make', 'cmake'],
    linuxNote: 'Note: zstd compiled from bundled sources',
    win32: ['mingw-w64', 'cmake', 'make'],
    win32Note: 'Note: Compression via Cabinet API (no extra deps)',
  },
})

#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for yoga-layout-builder
 *
 * Installs required system dependencies:
 * - Linux: gcc, make, cmake, python3
 * - macOS: clang (Xcode), make, cmake, python3
 * - Windows: mingw-w64, make, cmake, python3
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runSetupToolchain } from 'build-infra/lib/setup-build-toolchain'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

await runSetupToolchain({
  packageName: 'yoga-layout-builder',
  packageRoot,
  tools: {
    darwin: ['clang', 'make', 'cmake', 'python3'],
    linux: ['gcc', 'make', 'cmake', 'python3'],
    win32: ['mingw-w64', 'make', 'cmake', 'python3'],
  },
})

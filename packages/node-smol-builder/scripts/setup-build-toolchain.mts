#!/usr/bin/env node
/**
 * @file Setup build toolchain for node-smol-builder
 *   Installs required system dependencies:
 *
 *   - Linux: gcc, make, libssl-dev
 *   - macOS: clang (Xcode), make, openssl@3
 *   - Windows: mingw-w64, make Node 26+ Temporal support is provided by the
 *     temporal-infra C++ port (packages/temporal-infra/), with patch 037
 *     routing V8's #include "temporal_rs/X.hpp" to the source-only shim. No
 *     Rust toolchain needed.
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

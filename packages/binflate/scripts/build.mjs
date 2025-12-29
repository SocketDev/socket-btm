#!/usr/bin/env node
/**
 * Build script for binflate C package
 * Wraps the Makefile build target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCPackage } from 'build-infra/lib/c-package-builder'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

buildCPackage({
  packageName: 'binflate',
  packageDir: packageRoot,
})

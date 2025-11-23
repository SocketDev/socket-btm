/**
 * @fileoverview Shared utilities for build toolchain setup
 *
 * Common functionality used across platform-specific setup modules:
 * - Logger instance
 * - CI detection
 * - Tool installation utilities
 * - Package cache management
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  installTools,
  updatePackageCache,
} from '../../../build-infra/lib/install-tools.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..', '..')

/**
 * Get configured logger instance
 */
export function getLogger() {
  return getDefaultLogger()
}

/**
 * Get package root directory
 */
export function getPackageRoot() {
  return packageRoot
}

/**
 * Check if running in CI environment
 */
export function isCI() {
  return Boolean(process.env.CI)
}

/**
 * Install tools with standard error handling
 */
export async function install(tools, options = {}) {
  return await installTools(tools, {
    packageRoot,
    ...options,
  })
}

/**
 * Update package cache (Linux only)
 */
export function updateCache() {
  updatePackageCache()
}

export { installTools, updatePackageCache }

/**
 * Path constants for build-infra package.
 *
 * Provides paths to key directories and files in the monorepo structure.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: lib/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Monorepo root: packages/build-infra/../../
export const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')

// Node.js version file at monorepo root
export const NODE_VERSION_FILE = path.join(MONOREPO_ROOT, '.node-version')

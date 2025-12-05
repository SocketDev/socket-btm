/**
 * Node.js version helpers.
 *
 * Reads the Node.js version from the .node-version file at the monorepo root.
 */

import { readFileSync } from 'node:fs'

import { NODE_VERSION_FILE } from './paths.mjs'

export const nodeVersionRaw = readFileSync(NODE_VERSION_FILE, 'utf-8').trim()

export const NODE_VERSION = `v${nodeVersionRaw}`

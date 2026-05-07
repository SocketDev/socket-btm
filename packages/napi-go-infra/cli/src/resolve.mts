/**
 * Resolve build-environment details for napi-go bindings: Node include
 * path, target triple mapping, C toolchain invocation shape.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * Platform-arch → Go GOOS/GOARCH triple.
 *
 * @type {Readonly<Record<string, { goos: string, goarch: string }>>}
 */
export const GO_TARGETS = Object.freeze({
  __proto__: null,
  'darwin-arm64': { goos: 'darwin', goarch: 'arm64' },
  'darwin-x64': { goos: 'darwin', goarch: 'amd64' },
  'linux-arm64': { goos: 'linux', goarch: 'arm64' },
  'linux-arm64-musl': { goos: 'linux', goarch: 'arm64' },
  'linux-x64': { goos: 'linux', goarch: 'amd64' },
  'linux-x64-musl': { goos: 'linux', goarch: 'amd64' },
  'win-arm64': { goos: 'windows', goarch: 'arm64' },
  'win-x64': { goos: 'windows', goarch: 'amd64' },
})

/**
 * Get the Go GOOS/GOARCH pair for a platform-arch string.
 *
 * @param {string} platformArch
 * @returns {{ goos: string, goarch: string }}
 */
export function getGoTarget(platformArch) {
  const entry = GO_TARGETS[platformArch]
  if (!entry) {
    throw new Error(
      `napi-go: unsupported platform-arch '${platformArch}'. ` +
        `Expected one of: ${Object.keys(GO_TARGETS).filter(k => k !== '__proto__').join(', ')}`,
    )
  }
  return entry
}

/**
 * Resolve the directory holding Node.js's C headers (node_api.h and
 * friends) for the currently executing `node` binary.
 *
 * Strategy: walk up from process.execPath to a `<prefix>/include/node`
 * directory. For nvm, Homebrew, and official tarball installs this
 * lands one or two levels up from the bin directory. Returns the
 * absolute include directory, or throws with an actionable message.
 *
 * @returns {string} Absolute path to the include/node directory.
 */
export function getNodeIncludeDir() {
  const exec = process.execPath
  let cur = path.dirname(path.dirname(exec)) // drop bin/
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(cur, 'include', 'node')
    if (existsSync(path.join(candidate, 'node_api.h'))) {
      return candidate
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  throw new Error(
    `napi-go: could not locate Node.js headers. Expected 'node_api.h' ` +
      `under <prefix>/include/node/ relative to ${exec}. ` +
      `If Node was installed in a non-standard layout, set NODE_API_INCLUDE_DIR ` +
      `to the directory containing node_api.h and re-run the build.`,
  )
}

/**
 * Resolve the Node include directory, honoring the
 * NODE_API_INCLUDE_DIR env override for non-standard layouts.
 *
 * @returns {string}
 */
export function resolveNodeIncludeDir() {
  const override = process.env['NODE_API_INCLUDE_DIR']
  if (override) {
    if (!existsSync(path.join(override, 'node_api.h'))) {
      throw new Error(
        `napi-go: NODE_API_INCLUDE_DIR='${override}' does not contain node_api.h. ` +
          `Unset the variable or point it at a directory with node_api.h.`,
      )
    }
    return override
  }
  return getNodeIncludeDir()
}

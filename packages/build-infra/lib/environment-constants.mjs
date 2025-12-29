/**
 * Environment Detection Constants
 *
 * Centralized constants for detecting container environments, platforms,
 * and system-level paths used across build infrastructure.
 */

import { homedir } from 'node:os'
import path from 'node:path'

// Container detection files
export const DOCKER_ENV_FILE = '/.dockerenv'
export const PODMAN_ENV_FILE = '/run/.containerenv'
export const ALPINE_RELEASE_FILE = '/etc/alpine-release'

// Linux proc filesystem paths
export const PROC_CGROUP_FILE = '/proc/1/cgroup'
export const PROC_SELF_EXE = '/proc/self/exe'

// CI/Container workspace paths
export const WORKSPACE_DIR = '/workspace'

// Homebrew path patterns
export const HOMEBREW_CELLAR_EMSCRIPTEN_PATTERN = '/Cellar/emscripten/'

// Emscripten SDK search paths by platform
export const EMSDK_SEARCH_PATHS = {
  darwin: [
    path.join(homedir(), '.emsdk'),
    path.join(homedir(), 'emsdk'),
    '/opt/emsdk',
    '/usr/local/emsdk',
  ],
  linux: [
    path.join(homedir(), '.emsdk'),
    path.join(homedir(), 'emsdk'),
    '/opt/emsdk',
    '/usr/local/emsdk',
  ],
  win32: [
    path.join(homedir(), '.emsdk'),
    path.join(homedir(), 'emsdk'),
    'C:\\emsdk',
  ],
}

/**
 * Get Emscripten SDK search paths for the current or specified platform.
 * @param {string} [platform] - Platform override (darwin, linux, win32)
 * @returns {string[]} Array of paths to search for EMSDK
 */
export function getEmsdkSearchPaths(platform = process.platform) {
  return EMSDK_SEARCH_PATHS[platform] || EMSDK_SEARCH_PATHS.linux
}

// Compiler paths (Linux)
export const COMPILER_PATHS = {
  linux: {
    gccVersioned: version => `/usr/bin/gcc-${version}`,
    gxxVersioned: version => `/usr/bin/g++-${version}`,
    gccDefault: '/usr/bin/gcc',
    gxxDefault: '/usr/bin/g++',
  },
}

/**
 * Get GCC path for a specific version.
 * @param {number} version - GCC version number
 * @returns {string} Path to versioned GCC
 */
export function getGccPath(version) {
  return COMPILER_PATHS.linux.gccVersioned(version)
}

/**
 * Get G++ path for a specific version.
 * @param {number} version - G++ version number
 * @returns {string} Path to versioned G++
 */
export function getGxxPath(version) {
  return COMPILER_PATHS.linux.gxxVersioned(version)
}

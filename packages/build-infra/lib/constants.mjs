/**
 * Shared constants for Socket BTM build infrastructure
 *
 * Consolidated from: constants.mjs, environment-constants.mjs, paths.mjs, node-version.mjs
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// =============================================================================
// Path Constants
// =============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// =============================================================================
// Build Constants
// =============================================================================

/**
 * Byte conversion constants for consistent size calculations
 */
export const BYTES = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
}

/**
 * Build stage directory names used across packages.
 * Use these instead of hardcoded strings to ensure consistency.
 */
export const BUILD_STAGES = {
  RELEASE: 'Release',
  STRIPPED: 'Stripped',
  COMPRESSED: 'Compressed',
  FINAL: 'Final',
  OPTIMIZED: 'Optimized',
  SYNC: 'Sync',
}

/**
 * Checkpoint names used by checkpoint-manager.
 * Use these instead of hardcoded strings to ensure consistency.
 */
export const CHECKPOINTS = {
  // Common/universal checkpoints.
  FINALIZED: 'finalized',

  // Model/data pipeline checkpoints.
  DOWNLOADED: 'downloaded',
  CONVERTED: 'converted',
  QUANTIZED: 'quantized',
  OPTIMIZED: 'optimized',

  // WASM pipeline checkpoints.
  SOURCE_COPIED: 'source-copied',
  SOURCE_CONFIGURED: 'source-configured',
  WASM_COMPILED: 'wasm-compiled',
  WASM_OPTIMIZED: 'wasm-optimized',
  WASM_RELEASED: 'wasm-released',
  WASM_SYNCED: 'wasm-synced',

  // Binary/native build checkpoints.
  BINARY_COMPRESSED: 'binary-compressed',
  BINARY_RELEASED: 'binary-released',
  BINARY_STRIPPED: 'binary-stripped',
  LIEF_BUILT: 'lief-built',
  MBEDTLS_BUILT: 'mbedtls-built',
  SOURCE_PATCHED: 'source-patched',
}

// Set of all valid checkpoint values for runtime validation.
const VALID_CHECKPOINT_VALUES = new Set(Object.values(CHECKPOINTS))

/**
 * Checkpoint chain generators for each package type.
 * Centralized to avoid duplication across packages.
 */
export const CHECKPOINT_CHAINS = {
  /**
   * Curl build checkpoint chain.
   * Used by build-curl.mjs for libcurl with mbedTLS.
   */
  curl: () => [CHECKPOINTS.FINALIZED, CHECKPOINTS.MBEDTLS_BUILT],

  /**
   * Model pipeline checkpoint chain (with optimization step).
   * Used by codet5-models-builder, minilm-builder.
   * Same for dev and prod.
   */
  model: () => [
    CHECKPOINTS.FINALIZED,
    CHECKPOINTS.OPTIMIZED,
    CHECKPOINTS.QUANTIZED,
    CHECKPOINTS.CONVERTED,
    CHECKPOINTS.DOWNLOADED,
  ],

  /**
   * Simple model pipeline checkpoint chain (without optimization).
   * Used by models package for basic model downloads.
   * Same for dev and prod.
   */
  modelSimple: () => [
    CHECKPOINTS.FINALIZED,
    CHECKPOINTS.QUANTIZED,
    CHECKPOINTS.CONVERTED,
    CHECKPOINTS.DOWNLOADED,
  ],

  /**
   * Node-smol binary pipeline checkpoint chain.
   * Same for dev and prod.
   */
  nodeSmol: () => [
    CHECKPOINTS.FINALIZED,
    CHECKPOINTS.BINARY_COMPRESSED,
    CHECKPOINTS.BINARY_STRIPPED,
    CHECKPOINTS.BINARY_RELEASED,
    CHECKPOINTS.SOURCE_PATCHED,
    CHECKPOINTS.SOURCE_COPIED,
  ],

  /**
   * Simple single-checkpoint chain.
   * Used by binsuite packages (binpress, binflate, binject) and stubs.
   */
  simple: () => [CHECKPOINTS.FINALIZED],

  /**
   * ONNX Runtime WASM pipeline checkpoint chain.
   * Dev skips wasm-optimized for faster builds.
   */
  onnxruntime: mode => {
    if (mode === 'prod') {
      return [
        CHECKPOINTS.FINALIZED,
        CHECKPOINTS.WASM_SYNCED,
        CHECKPOINTS.WASM_OPTIMIZED,
        CHECKPOINTS.WASM_RELEASED,
        CHECKPOINTS.WASM_COMPILED,
      ]
    }
    // Dev: skips wasm-optimized (faster builds, larger files).
    return [
      CHECKPOINTS.FINALIZED,
      CHECKPOINTS.WASM_SYNCED,
      CHECKPOINTS.WASM_RELEASED,
      CHECKPOINTS.WASM_COMPILED,
    ]
  },

  /**
   * Yoga Layout WASM pipeline checkpoint chain.
   * Dev skips wasm-optimized for faster builds.
   * Includes SOURCE_CONFIGURED (yoga needs configuration step).
   */
  yoga: mode => {
    if (mode === 'prod') {
      return [
        CHECKPOINTS.FINALIZED,
        CHECKPOINTS.WASM_SYNCED,
        CHECKPOINTS.WASM_OPTIMIZED,
        CHECKPOINTS.WASM_RELEASED,
        CHECKPOINTS.WASM_COMPILED,
        CHECKPOINTS.SOURCE_CONFIGURED,
      ]
    }
    // Dev: skips wasm-optimized (faster builds, larger files).
    return [
      CHECKPOINTS.FINALIZED,
      CHECKPOINTS.WASM_SYNCED,
      CHECKPOINTS.WASM_RELEASED,
      CHECKPOINTS.WASM_COMPILED,
      CHECKPOINTS.SOURCE_CONFIGURED,
    ]
  },
}

/**
 * Validate a checkpoint chain at runtime.
 * Ensures all checkpoints in the chain are valid CHECKPOINTS constants.
 *
 * @param {string[]} chain - Checkpoint chain to validate (newest → oldest)
 * @param {string} packageName - Package name for error messages
 * @throws {Error} If chain contains invalid checkpoint names
 */
export function validateCheckpointChain(chain, packageName) {
  if (!Array.isArray(chain)) {
    throw new Error(`${packageName}: Checkpoint chain must be an array`)
  }

  if (chain.length === 0) {
    throw new Error(`${packageName}: Checkpoint chain cannot be empty`)
  }

  const invalid = chain.filter(cp => !VALID_CHECKPOINT_VALUES.has(cp))
  if (invalid.length > 0) {
    throw new Error(
      `${packageName}: Invalid checkpoint names in chain: ${invalid.join(', ')}. ` +
        `Valid checkpoints: ${Object.keys(CHECKPOINTS).join(', ')}`,
    )
  }

  // Check for duplicates.
  const seen = new Set()
  for (const cp of chain) {
    if (seen.has(cp)) {
      throw new Error(`${packageName}: Duplicate checkpoint in chain: ${cp}`)
    }
    seen.add(cp)
  }
}

// Validate all checkpoint chains at module load time.
// This catches typos and invalid checkpoint names early.
for (const [name, generator] of Object.entries(CHECKPOINT_CHAINS)) {
  // Some generators require a mode argument.
  if (name === 'onnxruntime' || name === 'yoga') {
    validateCheckpointChain(generator('dev'), `CHECKPOINT_CHAINS.${name}(dev)`)
    validateCheckpointChain(
      generator('prod'),
      `CHECKPOINT_CHAINS.${name}(prod)`,
    )
  } else {
    validateCheckpointChain(generator(), `CHECKPOINT_CHAINS.${name}`)
  }
}

/**
 * Maximum Node.js binary size that binject can process
 * Matches MAX_ELF_SIZE and MAX_PE_SIZE in binject C source (200 MB)
 *
 * This limit applies to the final Node.js binary (ELF or PE format) that
 * binject processes.
 */
export const MAX_NODE_BINARY_SIZE = 200 * BYTES.MB

/**
 * Maximum SEA (Single Executable Application) blob size
 * Matches Node.js's kMaxPayloadSize limit (2 GB - 1 byte)
 *
 * This is the maximum size for the application code embedded in the
 * NODE_SEA_BLOB section of a Node.js binary.
 */
export const MAX_SEA_BLOB_SIZE = 2_147_483_647

/**
 * Maximum VFS (Virtual File System) size
 * Matches MAX_RESOURCE_SIZE in binject C source (500 MB)
 *
 * This is the maximum size for the virtual file system data embedded in the
 * NODE_VFS_BLOB section.
 */
export const MAX_VFS_SIZE = 500 * BYTES.MB

// =============================================================================
// Environment Detection Constants
// =============================================================================

/**
 * Container detection files
 */
export const DOCKER_ENV_FILE = '/.dockerenv'
export const PODMAN_ENV_FILE = '/run/.containerenv'
export const ALPINE_RELEASE_FILE = '/etc/alpine-release'

/**
 * Linux proc filesystem paths
 */
export const PROC_CGROUP_FILE = '/proc/1/cgroup'
export const PROC_SELF_EXE = '/proc/self/exe'

/**
 * CI/Container workspace paths
 */
export const WORKSPACE_DIR = '/workspace'

/**
 * Homebrew path patterns
 */
export const HOMEBREW_CELLAR_EMSCRIPTEN_PATTERN = '/Cellar/emscripten/'

/**
 * Emscripten SDK search paths by platform
 */
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
 * Compiler paths (Linux)
 */
export const COMPILER_PATHS = {
  linux: {
    gccVersioned: version => `/usr/bin/gcc-${version}`,
    gxxVersioned: version => `/usr/bin/g++-${version}`,
    gccDefault: '/usr/bin/gcc',
    gxxDefault: '/usr/bin/g++',
  },
}

/**
 * Package root directory (build-infra)
 */
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

/**
 * Monorepo root directory
 */
export const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')

/**
 * Node.js version file at monorepo root
 */
export const NODE_VERSION_FILE = path.join(MONOREPO_ROOT, '.node-version')

// =============================================================================
// Node.js Version
// =============================================================================

/**
 * Raw Node.js version from .node-version file (e.g., "22.13.1")
 */
export const nodeVersionRaw = readFileSync(NODE_VERSION_FILE, 'utf-8').trim()

/**
 * Node.js version with 'v' prefix (e.g., "v22.13.1")
 */
export const NODE_VERSION = `v${nodeVersionRaw}`

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the BUILD_MODE from environment variable.
 * Defaults to 'prod' in CI, 'dev' otherwise.
 * @returns {string} The build mode ('dev' or 'prod')
 */
export function getBuildMode() {
  if (process.env.BUILD_MODE) {
    return process.env.BUILD_MODE
  }
  return process.env.CI ? 'prod' : 'dev'
}

/**
 * Get binary output directory for a package.
 * Packages (binpress, binflate, binject) build to build/${BUILD_MODE}/out/Final/
 * @param {string} packageDir - The package directory path
 * @returns {string} The output directory path
 */
export function getBinOutDir(packageDir) {
  const buildMode = getBuildMode()
  return `${packageDir}/build/${buildMode}/out/${BUILD_STAGES.FINAL}`
}

/**
 * Get Emscripten SDK search paths for the current or specified platform.
 * @param {string} [platform] - Platform override (darwin, linux, win32)
 * @returns {string[]} Array of paths to search for EMSDK
 */
export function getEmsdkSearchPaths(platform = process.platform) {
  return EMSDK_SEARCH_PATHS[platform] || EMSDK_SEARCH_PATHS.linux
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

// =============================================================================
// Compressed Binary Format Constants
// =============================================================================

/**
 * Magic marker to identify the start of compressed data in self-extracting binaries.
 * The marker is 32 bytes long and must match EXACTLY with the C++ stub code.
 *
 * C++ equivalent (split to prevent self-reference):
 *   MAGIC_MARKER_PART1 = "__SMOL"
 *   MAGIC_MARKER_PART2 = "_PRESSED_DATA"
 *   MAGIC_MARKER_PART3 = "_MAGIC_MARKER"
 *   MAGIC_MARKER_LEN = 32
 *
 * @type {string}
 */
export const SMOL_PRESSED_DATA_MAGIC_MARKER = '__SMOL_PRESSED_DATA_MAGIC_MARKER'

/**
 * Binary format structure:
 * - Magic marker (32 bytes)
 * - Compressed size (8 bytes, uint64_t little-endian)
 * - Uncompressed size (8 bytes, uint64_t little-endian)
 * - Cache key (16 bytes, hex string)
 * - Platform metadata (3 bytes):
 *   - platform (1 byte): 0=linux, 1=darwin, 2=win32
 *   - arch (1 byte): 0=x64, 1=arm64, 2=ia32, 3=arm
 *   - libc (1 byte): 0=glibc, 1=musl, 255=n/a (for non-Linux)
 * - Smol config present flag (1 byte): 0=no config, 1=has config
 * - Smol config binary (1176 bytes, if flag=1):
 *   - Magic (4 bytes): 0x534D4647 ("SMFG")
 *   - Version (2 bytes): 1
 *   - Config data (1170 bytes): update config + fakeArgvEnv (validated at build time)
 * - Compressed data (variable length)
 *
 * Note: All platforms now use LZFSE compression exclusively
 */
export const HEADER_SIZES = {
  CACHE_KEY: 16,
  COMPRESSED_SIZE: 8,
  MAGIC_MARKER: 32,
  PLATFORM_METADATA: 3,
  SMOL_CONFIG_BINARY: 1176,
  SMOL_CONFIG_FLAG: 1,
  UNCOMPRESSED_SIZE: 8,
}

/**
 * Platform metadata byte values.
 */
export const PLATFORM_VALUES = {
  darwin: 1,
  linux: 0,
  win32: 2,
}

export const ARCH_VALUES = {
  arm: 3,
  arm64: 1,
  ia32: 2,
  x64: 0,
}

export const LIBC_VALUES = {
  glibc: 0,
  musl: 1,
  na: 255,
}

/**
 * Compression algorithm byte values.
 */
export const COMPRESSION_VALUES = {
  lzfse: 0,
  lzma: 1,
  lzms: 2,
}

/**
 * Metadata header size (excluding magic marker, smol config, and compressed data).
 * compressed_size (8) + uncompressed_size (8) + cache_key (16) + platform_metadata (3) + smol_config_flag (1) = 36 bytes
 */
export const METADATA_HEADER_SIZE =
  HEADER_SIZES.COMPRESSED_SIZE +
  HEADER_SIZES.UNCOMPRESSED_SIZE +
  HEADER_SIZES.CACHE_KEY +
  HEADER_SIZES.PLATFORM_METADATA +
  HEADER_SIZES.SMOL_CONFIG_FLAG

/**
 * Total header size without smol config (excluding compressed data).
 * marker (32) + metadata (36) = 68 bytes
 */
export const TOTAL_HEADER_SIZE_WITHOUT_SMOL_CONFIG =
  HEADER_SIZES.MAGIC_MARKER + METADATA_HEADER_SIZE

/**
 * Total header size with smol config (excluding compressed data).
 * marker (32) + metadata (36) + smol_config (1176) = 1244 bytes
 */
export const TOTAL_HEADER_SIZE_WITH_SMOL_CONFIG =
  TOTAL_HEADER_SIZE_WITHOUT_SMOL_CONFIG + HEADER_SIZES.SMOL_CONFIG_BINARY

/**
 * Smol config binary size.
 */
export const SMOL_CONFIG_BINARY_SIZE = HEADER_SIZES.SMOL_CONFIG_BINARY

/**
 * Smol config magic number (ASCII "SMFG").
 */
export const SMOL_CONFIG_MAGIC = 0x53_4d_46_47

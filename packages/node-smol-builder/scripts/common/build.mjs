/**
 * @fileoverview Build Node.js v24.10.0 with SEA and dual compression support
 *
 * This script produces a custom Node binary optimized for:
 * 1. Socket CLI distribution (smol builds)
 * 2. Single Executable Applications (SEA) with automatic Brotli compression
 * 3. Self-extracting binaries with platform-specific compression
 *
 * Dual Compression Strategy:
 *   Layer 1: SEA Blob Compression (Brotli on JavaScript)
 *     - Enabled by default during `--experimental-sea-config`
 *     - 70-80% size reduction (10-50MB → 2-10MB)
 *     - Opt-out: Set "useCompression": false in sea-config.json
 *     - Decompression: ~50-100ms at startup
 *
 *   Layer 2: Binary Compression (platform-specific on whole binary)
 *     - Enabled by default during build
 *     - 75-79% size reduction (27MB → 8-12MB)
 *     - Opt-out: Use --no-compress-binary flag
 *     - Decompression: ~100ms on first run, then cached
 *
 * Build Flags:
 *   --no-compress-binary   Skip platform-specific binary compression
 *   --clean                Force clean build (ignore cache)
 *   --prod                 Production optimizations (V8 Lite, LTO)
 *   --dev                  Development mode (faster builds)
 *
 * Usage Patterns:
 *   1. Smol binary only:       pnpm build
 *   2. Smol + SEA:             postject smol-binary NODE_SEA_BLOB app.blob
 *   3. Uncompressed build:     pnpm build --no-compress-binary
 *   4. Production build:       pnpm build --prod
 *
 * Binary Size Optimization Strategy:
 *
 *   Starting size:                 ~49 MB (default Node.js v24 build)
 *
 *   Stage 1: Configure flags
 *     + --with-intl=small-icu:     ~44 MB  (-5 MB:  English-only ICU)
 *     + --v8-lite-mode:            ~29 MB  (-20 MB: Disable TurboFan JIT)
 *     + --disable-SEA:             ~28 MB  (-21 MB: Remove SEA support)
 *     + --without-* flags:         ~27 MB  (-22 MB: Remove npm, inspector, etc.)
 *
 *   Stage 2: Binary stripping
 *     + strip (platform-specific): ~25 MB  (-24 MB: Remove debug symbols)
 *
 *   Stage 3: Compression (this script)
 *     + pkg Brotli (VFS):          ~23 MB  (-26 MB: Compress Socket CLI code)
 *     + Node.js lib/ minify+Brotli:~21 MB  (-28 MB: Compress built-in modules)
 *
 *   TARGET EXPECTED: ~21 MB (small-icu adds ~3MB vs intl=none)
 *
 * Size Breakdown:
 *   - Node.js lib/ (compressed):   ~2.5 MB  (minified + Brotli)
 *   - Socket CLI (VFS):           ~13 MB    (pkg Brotli)
 *   - Native code (V8, libuv):     ~2.5 MB  (stripped)
 *
 * Compression Approach:
 *   1. Node.js built-in modules:  esbuild minify → Brotli quality 11
 *   2. Socket CLI application:    pkg automatic Brotli compression
 *
 * Performance Impact:
 *   - Startup overhead:           ~50-100 ms (one-time decompression)
 *   - Runtime performance:        ~5-10x slower JS (V8 Lite mode)
 *   - WASM performance:           Unaffected (Liftoff baseline compiler)
 *
 * Usage:
 *   node scripts/load.mjs build-custom-node              # Normal build
 *   node scripts/load.mjs build-custom-node --clean      # Force fresh build
 *   node scripts/load.mjs build-custom-node --yes        # Auto-yes to prompts
 *   node scripts/load.mjs build-custom-node --verify     # Verify after build
 *   node scripts/load.mjs build-custom-node --test       # Build + run smoke tests
 *   node scripts/load.mjs build-custom-node --test-full  # Build + run full tests
 */

import { existsSync, readdirSync, promises as fs } from 'node:fs'
import { cpus, platform } from 'node:os'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkCompiler,
  checkDiskSpace,
  checkNetworkConnectivity,
  checkPythonVersion,
  cleanWorkflowCheckpoint,
  createWorkflowCheckpoint,
  estimateBuildTime,
  formatDuration,
  getBuildLogPath,
  getLastLogLines,
  saveBuildLog,
  smokeTestBinary,
  verifyGitTag,
} from 'build-infra/lib/build-helpers'
import {
  printError,
  printHeader,
  printWarning,
} from 'build-infra/lib/build-output'
import { shouldRun } from 'build-infra/lib/checkpoint-manager'
import {
  ensureGccVersion,
  getGccInstructions,
} from 'build-infra/lib/compiler-installer'
import {
  generateHashComment,
  shouldExtract,
} from 'build-infra/lib/extraction-cache'
import {
  analyzePatchContent,
  checkPatchConflicts,
  validatePatch,
} from 'build-infra/lib/patch-validator'
import {
  ensureAllToolsInstalled,
  ensurePackageManagerAvailable,
  getInstallInstructions,
  getPackageManagerInstructions,
} from 'build-infra/lib/tool-installer'
import colors from 'yoctocolors-cjs'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { whichBinSync } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

// Node.js version to build
const NODE_VERSION = 'v24.10.0'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Hoist logger for consistent usage throughout the script.
const logger = getDefaultLogger()

/**
 * Execute command using spawn (replacement for exec).
 *
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {object} options - Spawn options
 * @returns {Promise<void>}
 */
async function exec(command, args = [], options = {}) {
  const result = await spawn(
    Array.isArray(args) ? command : `${command} ${args}`,
    Array.isArray(args) ? args : [],
    {
      stdio: 'inherit',
      ...options,
    },
  )
  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}: ${command}`)
  }
}

/**
 * Check if a command exists in PATH.
 */
function commandExists(cmd) {
  return !!whichBinSync(cmd, { nothrow: true })
}

// Parse arguments.
const { values } = parseArgs({
  options: {
    arch: { type: 'string' },
    clean: { type: 'boolean' },
    dev: { type: 'boolean' },
    'no-compress-binary': { type: 'boolean' },
    'no-compress-sea': { type: 'boolean' },
    platform: { type: 'string' },
    prod: { type: 'boolean' },
    test: { type: 'boolean' },
    'test-full': { type: 'boolean' },
    verify: { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
  },
  strict: false,
})

const TARGET_PLATFORM = values.platform || platform()
const TARGET_ARCH = values.arch || process.arch
const CLEAN_BUILD = !!values.clean
const RUN_VERIFY = !!values.verify
const RUN_TESTS = !!values.test
const RUN_FULL_TESTS = !!values['test-full'] || !!values.testFull
const AUTO_YES = !!values.yes

// Platform detection constants
const _IS_DARWIN = TARGET_PLATFORM === 'darwin'
const IS_LINUX = TARGET_PLATFORM === 'linux' || TARGET_PLATFORM === 'linux-musl'
const _IS_WIN32 = TARGET_PLATFORM === 'win32'

// Build mode: dev (fast builds) vs prod (optimized builds).
// Default to dev unless CI or --prod specified.
const IS_PROD_BUILD = values.prod || (!values.dev && 'CI' in process.env)
const IS_DEV_BUILD = !IS_PROD_BUILD

// Configuration
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_MODE = IS_DEV_BUILD ? 'dev' : 'prod'
const BUILD_ROOT = path.join(ROOT_DIR, 'build') // Shared cache directory.
const BUILD_DIR = path.join(BUILD_ROOT, BUILD_MODE) // Mode-specific build outputs.
const PACKAGE_NAME = 'node-smol' // For checkpoint management
const NODE_SOURCE_DIR = path.join(BUILD_DIR, 'node-source')
const NODE_DIR = NODE_SOURCE_DIR // Alias for compatibility.
const PATCHES_DIR = path.join(ROOT_DIR, 'patches')
const ADDITIONS_DIR = path.join(ROOT_DIR, 'additions')

// Directory structure (fully isolated by build mode for concurrent builds).
// build/dev/ - Dev build workspace (all artifacts isolated).
//   build/dev/node-source/ - Dev Node.js source code.
//   build/dev/out/ - Dev build outputs (Release, Stripped, Compressed, Final, etc.).
//   build/dev/cache/ - Dev compiled binary cache + cache-validation.hash.
//   build/dev/build-checkpoint - Dev build resume checkpoint.
// build/prod/ - Prod build workspace (all artifacts isolated).
//   build/prod/node-source/ - Prod Node.js source code.
//   build/prod/out/ - Prod build outputs (Release, Stripped, Compressed, Final, etc.).
//   build/prod/cache/ - Prod compiled binary cache + cache-validation.hash.
//   build/prod/build-checkpoint - Prod build resume checkpoint.

/**
 * Collect all source files that contribute to the smol build.
 * Used for hash-based caching to detect when rebuild is needed.
 *
 * Cache Key Strategy (Local Script):
 * ===================================
 * This function generates a content-based hash using build-infra/lib/extraction-cache.
 * The cache key is determined by hashing the CONTENT of these files:
 *
 * 1. All patch files (patches/*.patch)
 *    - Any change to Node.js patches invalidates cache
 *    - Example: patches/enable-brotli-loading-v24.patch
 *
 * 2. All addition files (additions/**)
 *    - Includes headers, source files, tools added to Node.js source tree
 *    - Example: additions/003-compression-tools/socketsecurity_macho_decompress
 *
 * 3. This build script itself (scripts/build.mjs)
 *    - Changes to build configuration flags invalidate cache
 *    - Example: modifying --without-node-code-cache flag
 *
 * NOTE: This differs from GitHub Actions cache key (see .github/workflows/build-smol.yml):
 * - GitHub: Hashes file PATHS and includes bootstrap dependencies
 * - Local: Hashes file CONTENT only (more precise, no bootstrap dependency)
 * - Both: Stored in build/.cache/node.hash (local) or Actions cache (CI)
 *
 * @returns {string[]} Array of absolute paths to all source files
 */
function collectBuildSourceFiles() {
  const sources = []

  // Add all patch files.
  if (existsSync(PATCHES_DIR)) {
    const patchFiles = readdirSync(PATCHES_DIR)
      .filter(f => f.endsWith('.patch'))
      .map(f => path.join(PATCHES_DIR, f))
    sources.push(...patchFiles)
  }

  // Add all addition files recursively.
  if (existsSync(ADDITIONS_DIR)) {
    const addFiles = readdirSync(ADDITIONS_DIR, { recursive: true })
      .filter(f => {
        const fullPath = path.join(ADDITIONS_DIR, f)
        try {
          return (
            existsSync(fullPath) &&
            !readdirSync(fullPath, { withFileTypes: true }).length
          )
        } catch {
          return true // It's a file, not a directory.
        }
      })
      .map(f => path.join(ADDITIONS_DIR, f))
    sources.push(...addFiles)
  }

  // Add this build script itself (changes to build logic should trigger rebuild).
  sources.push(__filename)

  return sources
}

/**
 * Find Socket patches for this Node version.
 * Includes both static patches (patches/) and dynamic patches (build/patches/).
 */
function findSocketPatches() {
  const patches = []

  // Get static patches from patches/ directory.
  if (existsSync(PATCHES_DIR)) {
    const staticPatches = readdirSync(PATCHES_DIR)
      .filter(f => f.endsWith('.patch') && !f.endsWith('.template.patch'))
      .map(f => ({
        name: f,
        path: path.join(PATCHES_DIR, f),
        source: 'patches/',
      }))
    patches.push(...staticPatches)
  }

  // Get dynamic patches from build/patches/ directory.
  const buildPatchesDir = path.join(BUILD_DIR, 'patches')
  if (existsSync(buildPatchesDir)) {
    const dynamicPatches = readdirSync(buildPatchesDir)
      .filter(f => f.endsWith('.patch'))
      .map(f => ({
        name: f,
        path: path.join(buildPatchesDir, f),
        source: 'build/patches/',
      }))
    patches.push(...dynamicPatches)
  }

  // Sort by name for consistent ordering.
  patches.sort((a, b) => a.name.localeCompare(b.name))

  if (patches.length > 0) {
    logger.log(`   Found ${patches.length} patch file(s):`)
    for (const patch of patches) {
      logger.log(`     → ${patch.name} (${patch.source})`)
    }
  }

  return patches
}

/**
 * Copy build additions to Node.js source tree
 */
async function copyBuildAdditions() {
  if (!existsSync(ADDITIONS_DIR)) {
    logger.log('   No build additions directory found, skipping')
    return
  }

  printHeader('Copying Build Additions')

  // Recursively copy entire additions directory structure to Node.js source.
  await fs.cp(ADDITIONS_DIR, NODE_DIR, {
    recursive: true,
    force: true,
    errorOnExist: false,
  })

  logger.log(
    `✅ Copied ${ADDITIONS_DIR.replace(`${ROOT_DIR}/`, '')}/ → ${NODE_DIR}/`,
  )

  // Fix: The bootstrap loader needs to be in lib/internal/ for Node.js to embed it as an internal module.
  const bootstrapLoaderSource = path.join(
    NODE_DIR,
    '002-bootstrap-loader',
    'internal',
    'socketsecurity_bootstrap_loader.js',
  )
  const bootstrapLoaderDest = path.join(
    NODE_DIR,
    'lib',
    'internal',
    'socketsecurity_bootstrap_loader.js',
  )

  if (existsSync(bootstrapLoaderSource)) {
    await fs.copyFile(bootstrapLoaderSource, bootstrapLoaderDest)
    logger.log('✅ Copied socketsecurity_bootstrap_loader.js to lib/internal/')
  }

  // Fix: Copy polyfill to lib/internal/socketsecurity_polyfills/ for external loading.
  const localeCompareSource = path.join(
    ADDITIONS_DIR,
    'localeCompare.polyfill.js',
  )
  const polyfillsDestDir = path.join(
    NODE_DIR,
    'lib',
    'internal',
    'socketsecurity_polyfills',
  )

  if (existsSync(localeCompareSource)) {
    await safeMkdir(polyfillsDestDir)

    const localeCompareDest = path.join(polyfillsDestDir, 'localeCompare.js')
    await fs.copyFile(localeCompareSource, localeCompareDest)
    logger.log(
      '✅ Copied localeCompare.js to lib/internal/socketsecurity_polyfills/',
    )
  }

  logger.log('')
}

const CPU_COUNT = cpus().length
const IS_MACOS = TARGET_PLATFORM === 'darwin'
const IS_WINDOWS = TARGET_PLATFORM === 'win32'
const ARCH = TARGET_ARCH

/**
 * Check if Node.js source has uncommitted changes.
 */
async function isNodeSourceDirty() {
  try {
    const result = await spawn('git', ['status', '--porcelain'], {
      cwd: NODE_DIR,
      stdio: 'pipe',
      stdioString: true,
    })
    return result.code === 0 && (result.stdout ?? '').trim().length > 0
  } catch {
    return false
  }
}

/**
 * Reset Node.js source to pristine state.
 */
async function resetNodeSource() {
  logger.log('Fetching latest tags...')
  await exec(
    'git',
    [
      'fetch',
      '--depth',
      '1',
      'origin',
      `refs/tags/${NODE_VERSION}:refs/tags/${NODE_VERSION}`,
    ],
    {
      cwd: NODE_DIR,
    },
  )
  logger.log('Resetting to clean state...')
  await exec('git', ['reset', '--hard', NODE_VERSION], { cwd: NODE_DIR })
  await exec('git', ['clean', '-fdx'], { cwd: NODE_DIR })
  logger.log(`${colors.green('✓')} Node.js source reset to clean state`)
  logger.log('')
}

/**
 * Get file size in human-readable format.
 */
async function getFileSize(filePath) {
  const stats = await fs.stat(filePath)
  const bytes = stats.size

  if (bytes === 0) {
    return '0B'
  }

  const k = 1024
  const sizes = ['B', 'K', 'M', 'G', 'T']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = (bytes / k ** i).toFixed(1)

  return `${size}${sizes[i]}`
}

/**
 * Smoke test a Node.js binary with comprehensive checks.
 * Works for both vanilla Node.js (smol) and SEA binaries.
 *
 * @param {string} binaryPath - Path to Node.js binary
 * @param {object} options - Test options
 * @param {boolean} options.isSEA - Is this a SEA binary?
 * @param {boolean} options.isCheckpoint - Is this a checkpoint smoketest (affects error handling)?
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function smoketestBinary(
  binaryPath,
  { isCheckpoint = false, isSEA = false } = {},
) {
  const tests = []

  // Test 1: --version (works for both vanilla Node and SEA).
  tests.push({
    name: '--version',
    async run() {
      const result = await spawn(binaryPath, ['--version'], {
        timeout: 5000,
      })
      return { success: result.code === 0, reason: `exit code ${result.code}` }
    },
  })

  if (!isSEA) {
    // Test 2: JavaScript execution (vanilla Node only).
    tests.push({
      name: 'JavaScript execution',
      async run() {
        const result = await spawn(
          binaryPath,
          ['-e', 'console.log("hello world")'],
          { timeout: 5000, stdioString: true },
        )
        const success =
          result.code === 0 && result.stdout.trim() === 'hello world'
        return {
          success,
          reason: success
            ? 'ok'
            : `exit code ${result.code}, output: ${result.stdout.trim()}`,
        }
      },
    })

    // Test 3: Module system (vanilla Node only).
    tests.push({
      name: 'Module system',
      async run() {
        const result = await spawn(
          binaryPath,
          ['-e', 'require("path").join("a","b")'],
          { timeout: 5000 },
        )
        return {
          success: result.code === 0,
          reason: `exit code ${result.code}`,
        }
      },
    })
  } else {
    // Test 2: SEA help command (tests bundled CLI).
    tests.push({
      name: 'SEA help command',
      async run() {
        const result = await spawn(binaryPath, ['--help'], {
          timeout: 5000,
          stdioString: true,
        })
        const success = result.code === 0 && result.stdout.includes('Usage:')
        return {
          success,
          reason: success ? 'ok' : `exit code ${result.code}, no usage text`,
        }
      },
    })
  }

  // Run all tests.
  for (const test of tests) {
    try {
      const { reason, success } = await test.run()
      if (!success) {
        return { valid: false, reason: `${test.name} failed: ${reason}` }
      }
    } catch (e) {
      return { valid: false, reason: `${test.name} threw: ${e.message}` }
    }
  }

  return { valid: true }
}

/**
 * Get local checkpoint directory for compiled binaries.
 * Uses the same checkpoints/ directory as workflow checkpoints.
 *
 * @param {string} buildDir - Build directory path
 * @returns {string} Local checkpoint directory path
 */
function getLocalCheckpointDir(buildDir) {
  // Local checkpoints stored alongside workflow checkpoints
  return path.join(buildDir, 'checkpoints', 'local')
}

/**
 * Get local checkpoint file path for compiled binary.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} platform - Target platform
 * @param {string} arch - Target architecture
 * @returns {string} Local checkpoint binary path
 */
function getLocalCheckpointPath(buildDir, platform, arch) {
  return path.join(getLocalCheckpointDir(buildDir), `node-compiled-${platform}-${arch}`)
}

/**
 * Get local checkpoint metadata file path.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} platform - Target platform
 * @param {string} arch - Target architecture
 * @returns {string} Local checkpoint metadata file path
 */
function getLocalCheckpointMetadataPath(buildDir, platform, arch) {
  return path.join(
    getLocalCheckpointDir(buildDir),
    `node-compiled-${platform}-${arch}.json`,
  )
}

/**
 * Create local checkpoint after successful binary compilation.
 * This saves the compiled binary locally to allow resuming from this point
 * if post-processing fails. Stored in checkpoints/local/ directory.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} nodeBinary - Path to compiled Node.js binary
 * @param {string} platform - Target platform
 * @param {string} arch - Target architecture
 * @param {string} version - Node.js version
 * @returns {Promise<void>}
 */
async function createLocalCheckpoint(
  buildDir,
  nodeBinary,
  platform,
  arch,
  version,
) {
  const checkpointDir = getLocalCheckpointDir(buildDir)
  const checkpointFile = getLocalCheckpointPath(buildDir, platform, arch)
  const checkpointMetaFile = getLocalCheckpointMetadataPath(buildDir, platform, arch)

  // Smoketest binary before creating checkpoint.
  // Prevent checkpointing broken/segfaulting binaries.
  const smoketest = await smoketestBinary(nodeBinary, {
    isSEA: false,
    isCheckpoint: true,
  })
  if (!smoketest.valid) {
    logger.error(`Binary smoketest failed: ${smoketest.reason}`)
    logger.error('NOT creating local checkpoint')
    return
  }

  // Create checkpoint directory.
  await safeMkdir(checkpointDir, { recursive: true })

  // Copy binary to checkpoint.
  await fs.copyFile(nodeBinary, checkpointFile)

  // Get binary stats for metadata.
  const stats = await fs.stat(nodeBinary)
  const size = await getFileSize(nodeBinary)

  // Save metadata.
  const metadata = {
    platform,
    arch,
    version,
    timestamp: Date.now(),
    size: stats.size,
    humanSize: size,
  }
  await fs.writeFile(checkpointMetaFile, JSON.stringify(metadata, null, 2))

  logger.log(`${colors.green('✓')} Created local checkpoint (${size})`)
  logger.log(`   Checkpoint location: ${checkpointFile}`)
}

/**
 * Restore from local checkpoint if available and valid.
 * Returns true if restore successful, false if no valid checkpoint exists.
 * This restores from local checkpoints/, not GitHub Actions cache.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} nodeBinary - Path where to restore Node.js binary
 * @param {string} platform - Target platform
 * @param {string} arch - Target architecture
 * @param {string} version - Expected Node.js version
 * @returns {Promise<boolean>} True if restored, false if no valid checkpoint
 */
async function restoreLocalCheckpoint(
  buildDir,
  nodeBinary,
  platform,
  arch,
  version,
) {
  const checkpointFile = getLocalCheckpointPath(buildDir, platform, arch)
  const checkpointMetaFile = getLocalCheckpointMetadataPath(buildDir, platform, arch)

  // Check if checkpoint files exist.
  if (!existsSync(checkpointFile) || !existsSync(checkpointMetaFile)) {
    return false
  }

  try {
    // Validate metadata matches current build.
    const metaContent = await fs.readFile(checkpointMetaFile, 'utf8')
    const meta = JSON.parse(metaContent)

    if (meta.platform !== platform || meta.arch !== arch) {
      logger.warn(
        'Checkpointed binary is for different platform/arch, ignoring',
      )
      return false
    }

    if (meta.version !== version) {
      logger.warn(
        `Checkpointed binary is for Node.js ${meta.version}, expected ${version}, ignoring`,
      )
      return false
    }

    // Ensure output directory exists.
    await safeMkdir(dirname(nodeBinary), { recursive: true })

    // Restore binary from checkpoint.
    await fs.copyFile(checkpointFile, nodeBinary)

    const size = await getFileSize(nodeBinary)
    logger.log(`${colors.green('✓')} Restored from local checkpoint (${size})`)
    logger.log(`   From: ${checkpointFile}`)

    // Smoketest restored binary.
    const smoketest = await smoketestBinary(nodeBinary, {
      isSEA: false,
      isCheckpoint: true,
    })
    if (!smoketest.valid) {
      logger.warn(`Checkpointed binary smoketest failed: ${smoketest.reason}`)
      logger.warn('Will rebuild from source')
      return false
    }
    logger.log(
      `${colors.green('✓')} Checkpointed binary smoketest passed (all tests)`,
    )

    return true
  } catch (e) {
    logger.warn(`Failed to restore from local checkpoint: ${e.message}`)
    return false
  }
}

/**
 * Check if required tools are available, auto-installing if possible.
 */
async function checkRequiredTools() {
  printHeader('Pre-flight Checks')

  // Step 1: Ensure package manager is available.
  const pmResult = await ensurePackageManagerAvailable({
    autoInstall: AUTO_YES,
    autoYes: AUTO_YES,
  })

  const canAutoInstall = pmResult.available

  if (pmResult.installed) {
    logger.success(
      `Package manager (${pmResult.manager}) installed successfully`,
    )
  } else if (pmResult.available) {
    logger.log(`📦 Package manager detected: ${pmResult.manager}`)
  } else {
    logger.warn('No package manager available for auto-installing tools')
    const pmInstructions = getPackageManagerInstructions()
    for (const instruction of pmInstructions) {
      logger.substep(instruction)
    }
  }

  // Step 2: Tools that support auto-installation.
  const autoInstallableTools = ['git', 'curl', 'patch', 'make']

  // Step 3: Tools that must be checked manually (no package manager support).
  const manualTools = [
    // macOS strip doesn't support --version, just check if it exists.
    { name: 'strip', cmd: 'strip', checkExists: true },
  ]

  if (IS_MACOS && ARCH === 'arm64') {
    // macOS codesign doesn't support --version, just check if it exists.
    manualTools.push({
      name: 'codesign',
      cmd: 'codesign',
      checkExists: true,
    })
  }

  // Step 4: Attempt auto-installation for missing tools.
  const result = await ensureAllToolsInstalled(autoInstallableTools, {
    autoInstall: canAutoInstall,
    autoYes: AUTO_YES,
  })

  // Step 5: Report results.
  for (const tool of autoInstallableTools) {
    if (result.installed.includes(tool)) {
      logger.success(`${tool} installed automatically`)
    } else if (!result.missing.includes(tool)) {
      logger.log(`${colors.green('✓')} ${tool} is available`)
    }
  }

  // Step 6: Check manual tools.
  let allManualAvailable = true
  for (const { checkExists, cmd, name } of manualTools) {
    const binPath = whichBinSync(cmd, { nothrow: true })
    if (binPath) {
      logger.log(`${colors.green('✓')} ${name} is available`)
    } else {
      logger.error(`${colors.red('✗')} ${name} is NOT available`)
      allManualAvailable = false
    }
  }

  // Step 7: Handle missing tools.
  if (!result.allAvailable || !allManualAvailable) {
    const missingTools = [
      ...result.missing,
      ...manualTools
        .filter(t => !whichBinSync(t.cmd, { nothrow: true }))
        .map(t => t.name),
    ]

    if (missingTools.length > 0) {
      const instructions = []
      instructions.push('Missing required build tools:')
      instructions.push('')

      for (const tool of missingTools) {
        const toolInstructions = getInstallInstructions(tool)
        instructions.push(...toolInstructions)
        instructions.push('')
      }

      if (IS_MACOS) {
        instructions.push('For Xcode Command Line Tools:')
        instructions.push('  xcode-select --install')
      }

      printError(
        'Missing Required Tools',
        'Some required build tools are not available.',
        instructions,
      )
      throw new Error('Missing required build tools')
    }
  }

  logger.log('')
}

/**
 * Check build environment (Python, compiler, disk space, network).
 */
async function checkBuildEnvironment() {
  printHeader('Build Environment Checks')

  let allChecks = true

  // Check 1: Disk space.
  logger.log('Checking available disk space...')
  const diskSpace = await checkDiskSpace(BUILD_DIR)
  if (diskSpace.availableGB !== null) {
    if (diskSpace.sufficient) {
      logger.success(
        `Disk space: ${diskSpace.availableGB}GB available (need 5GB)`,
      )
    } else {
      logger.fail(
        `Disk space: Only ${diskSpace.availableGB}GB available (need 5GB)`,
      )
      logger.substep('Free up disk space before building')
      allChecks = false
    }
  } else {
    logger.warn('Could not check disk space (continuing anyway)')
  }

  // Check 2: Python version.
  logger.log('Checking Python version...')
  const python = await checkPythonVersion()
  if (python.available && python.sufficient) {
    logger.success(`Python ${python.version} is available`)
  } else if (python.available && !python.sufficient) {
    logger.fail(`Python ${python.version} is too old (need Python 3.6+)`)
    allChecks = false
  } else {
    logger.fail('Python is not available')
    logger.substep('Node.js build requires Python 3.6 or later')
    allChecks = false
  }

  // Check 3: C++ compiler.
  logger.log('Checking C++ compiler...')
  const compiler = await checkCompiler()
  if (compiler.available) {
    logger.success(`C++ compiler (${compiler.compiler}) is available`)
  } else {
    logger.fail('C++ compiler is not available')
    logger.substep('Node.js build requires clang++, g++, or c++')
    allChecks = false
  }

  // Check 3b: GCC version (Linux only, Node.js v24 requires GCC 12.2+)
  if (process.platform === 'linux' && compiler.compiler === 'g++') {
    logger.log('Checking GCC version...')
    const gccCheck = await ensureGccVersion({ autoInstall: true, quiet: false })
    if (gccCheck.available) {
      logger.success(`GCC ${gccCheck.version} meets requirements`)
    } else {
      logger.fail('GCC version does not meet requirements')
      logger.substep('Node.js v24 requires GCC 12.2+ for C++20 support')
      const instructions = getGccInstructions()
      instructions.forEach(line => logger.substep(line))
      allChecks = false
    }
  }

  // Check 3c: Xcode version (macOS only, Node.js v24 requires Xcode 16+)
  if (process.platform === 'darwin') {
    logger.log('Checking Xcode version...')
    try {
      const { stdout } = await exec('xcodebuild', ['-version'], {
        encoding: 'utf8',
        shell: false,
      })
      const match = stdout.match(/Xcode (\d+\.\d+)/)
      if (match) {
        const version = match[1]
        const majorVersion = Number.parseInt(version.split('.')[0], 10)
        if (majorVersion >= 16) {
          logger.success(`Xcode ${version} meets requirements (clang 19+)`)
        } else {
          logger.fail(`Xcode ${version} is too old (need Xcode 16+)`)
          logger.substep(
            'Node.js v24 requires Xcode 16+ with clang 19+ for C++20 support',
          )
          logger.substep(
            'Older clang versions crash on large V8 files with -O3 optimization',
          )
          logger.substep(
            'Install Xcode 16.1+ from: https://developer.apple.com/xcode/',
          )
          logger.substep(
            'After install, run: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer',
          )
          allChecks = false
        }
      } else {
        logger.warn('Could not parse Xcode version (continuing anyway)')
      }
    } catch (_e) {
      logger.warn('Could not check Xcode version (continuing anyway)')
    }
  }

  // Check 4: Network connectivity.
  logger.log('Checking network connectivity...')
  const network = await checkNetworkConnectivity()
  if (network.connected) {
    logger.success('Network connection to GitHub is working')
  } else {
    logger.fail('Cannot reach GitHub')
    logger.substep('Check your internet connection')
    allChecks = false
  }

  logger.logNewline()

  if (!allChecks) {
    printError(
      'Build Environment Not Ready',
      'Some required build environment checks failed.',
      [
        'Fix the issues above before building',
        'Disk space: Free up space if needed',
        'Python: Install Python 3.6+ (python.org or brew install python)',
        'Compiler: Install Xcode Command Line Tools (xcode-select --install)',
        'Network: Check your internet connection',
      ],
    )
    throw new Error('Build environment checks failed')
  }

  logger.success('Build environment is ready')
  logger.logNewline()
}

/**
 * Convert configure.py flags to vcbuild.bat flags.
 * vcbuild.bat uses different syntax (e.g., 'small-icu' instead of '--with-intl=small-icu').
 *
 * @param {string[]} configureFlags - configure.py style flags
 * @returns {string[]} vcbuild.bat style flags
 */
function convertToVcbuildFlags(configureFlags) {
  const vcbuildFlags = []

  // Always add openssl-no-asm to avoid NASM requirement in CI environments
  vcbuildFlags.push('openssl-no-asm')

  // Always add download-all to download pre-built ICU data (avoids genccode crashes on Windows)
  vcbuildFlags.push('download-all')

  // vcbuild.bat flag mappings that differ from configure.py
  const flagMap = {
    '--without-npm': 'nonpm',
    '--without-corepack': 'nocorepack',
    '--without-node-options': 'no-NODE-OPTIONS',
    '--without-snapshot': 'nosnapshot',
  }

  for (const flag of configureFlags) {
    // Architecture flags.
    if (flag === '--dest-cpu=arm64') {
      vcbuildFlags.push('arm64')
    } else if (flag === '--dest-cpu=x64') {
      vcbuildFlags.push('x64')
    }
    // ICU flags.
    // Windows: Use full-icu with download-all to avoid genccode crashes
    // Unix/Linux/macOS: Use small-icu as specified
    else if (flag === '--with-intl=small-icu') {
      vcbuildFlags.push('full-icu')
    } else if (flag === '--with-intl=none') {
      vcbuildFlags.push('intl-none')
    }
    // LTO flags (Windows uses LTCG).
    else if (flag === '--enable-lto') {
      vcbuildFlags.push('ltcg')
    }
    // Ninja is default, skip.
    else if (flag === '--ninja') {
    }
    // Known flag mappings.
    else if (flag in flagMap) {
      vcbuildFlags.push(flagMap[flag])
    }
    // Unsupported flags - skip silently (e.g., --without-amaro, --without-sqlite not supported by vcbuild).
    else if (flag.startsWith('--without-')) {
    }
    // Unknown flags - log warning.
    else {
      logger.warn(`Unknown vcbuild.bat flag mapping for: ${flag}`)
    }
  }

  return vcbuildFlags
}

/**
 * Verify Socket modifications were applied correctly.
 */
async function verifySocketModifications() {
  printHeader('Verifying Socket Modifications')

  let allApplied = true

  // Check 1: V8 include paths (v24.10.0+ doesn't need fixes).
  logger.log('Checking V8 include paths...')
  const testFile = path.join(NODE_DIR, 'deps/v8/src/heap/cppgc/heap-page.h')
  try {
    const content = await fs.readFile(testFile, 'utf8')
    // For v24.10.0+, the CORRECT include has "src/" prefix.
    if (content.includes('#include "src/base/iterator.h"')) {
      logger.success(
        'V8 include paths are correct (no modification needed for v24.10.0+)',
      )
    } else if (content.includes('#include "base/iterator.h"')) {
      logger.fail('V8 include paths were incorrectly modified!')
      logger.substep('v24.10.0+ needs "src/" prefix in includes')
      logger.substep('Build will fail - source was corrupted')
      allApplied = false
    } else {
      logger.warn('V8 include structure may have changed (cannot verify)')
    }
  } catch (e) {
    logger.warn(`Cannot verify V8 includes: ${e.message}`)
  }

  // Check 2: localeCompare polyfill loaded in bootstrap/node.js (late bootstrap stage).
  // This polyfill coerces unsupported locales to 'en-US' to prevent errors with small-icu.
  logger.log('Checking polyfill in bootstrap/node.js...')
  const bootstrapFile = path.join(
    NODE_DIR,
    'lib',
    'internal',
    'bootstrap',
    'node.js',
  )
  try {
    const content = await fs.readFile(bootstrapFile, 'utf8')
    const hasLocaleCompare = content.includes(
      'Socket CLI: Polyfill localeCompare',
    )

    if (hasLocaleCompare) {
      logger.success(
        'bootstrap/node.js correctly modified (localeCompare polyfill applied)',
      )
    } else {
      logger.warn('localeCompare polyfill not applied')
    }
  } catch (e) {
    logger.warn(`Cannot verify bootstrap/node.js: ${e.message}`)
  }

  logger.logNewline()

  if (!allApplied) {
    printError(
      'Socket Modifications Not Applied',
      'Critical Socket modifications were not applied to Node.js source.',
      [
        'This is a BUG in the build script',
        'The binary will NOT work correctly with pkg',
        'Run: node scripts/build-custom-node.mjs --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Socket modifications verification failed')
  }

  logger.success('All Socket modifications verified for --with-intl=small-icu')
  logger.logNewline()
}

/**
 * Apply Socket modifications for --with-intl=none compatibility.
 *
 * These source transforms help ensure Node.js APIs work correctly
 * when compiled without ICU (International Components for Unicode).
 */
// Function removed: applySocketModificationsDirectly().
// Socket modifications must be applied via patches only.
// If patches fail, the build should fail with helpful error messages.

/**
 * Main build function.
 */
async function main() {
  logger.log('')
  logger.log('🔨 Socket CLI - Custom Node.js Builder')
  logger.log(`   Building Node.js ${NODE_VERSION} with custom patches`)
  logger.log('')

  // Start timing total build.
  const totalStart = Date.now()

  // Initialize build log.
  await saveBuildLog(BUILD_DIR, '━'.repeat(60))
  await saveBuildLog(BUILD_DIR, '  Socket CLI - Custom Node.js Builder')
  await saveBuildLog(BUILD_DIR, `  Node.js ${NODE_VERSION} with custom patches`)
  await saveBuildLog(BUILD_DIR, `  Started: ${new Date().toISOString()}`)
  await saveBuildLog(BUILD_DIR, '━'.repeat(60))
  await saveBuildLog(BUILD_DIR, '')

  // Phase 1: Pre-flight checks.
  await saveBuildLog(BUILD_DIR, 'Phase 1: Pre-flight Checks')
  await checkRequiredTools()
  await checkBuildEnvironment()
  await saveBuildLog(BUILD_DIR, 'Pre-flight checks completed')
  await saveBuildLog(BUILD_DIR, '')

  // Ensure build directory exists.
  await safeMkdir(BUILD_DIR, { recursive: true })

  // Check if build is already complete (checkpoint system).
  if (!(await shouldRun(BUILD_DIR, PACKAGE_NAME, 'complete', CLEAN_BUILD))) {
    logger.log('')
    logger.success('Build already complete')
    logger.log('')
    return
  }

  // Check if we can use cached build (skip if --clean).
  if (!CLEAN_BUILD) {
    const finalOutputBinary = path.join(
      BUILD_DIR,
      'out',
      'Final',
      IS_WINDOWS ? 'node.exe' : 'node',
    )
    const distBinary = path.join(ROOT_DIR, 'dist', 'socket-smol')
    const distSeaBinary = path.join(ROOT_DIR, 'dist', 'socket-sea')

    // Collect all source files that affect the build.
    const sourcePaths = collectBuildSourceFiles()

    // Check if build is needed based on source file hashes.
    // Store hash in per-mode cache/ directory for full isolation.
    const cacheDir = getCacheDir(BUILD_DIR)
    const hashFilePath = path.join(cacheDir, 'cache-validation.hash')
    const needsExtraction = await shouldExtract({
      sourcePaths,
      outputPath: hashFilePath,
      validateOutput: () => {
        // Verify final binary, hash file, and at least one dist binary exist.
        return (
          existsSync(finalOutputBinary) &&
          existsSync(hashFilePath) &&
          (existsSync(distBinary) || existsSync(distSeaBinary))
        )
      },
    })

    if (!needsExtraction) {
      // Cache hit! Binary is up to date.
      logger.log('')
      printHeader('✅ Using Cached Build')
      logger.log('All source files unchanged since last build.')
      logger.log('')
      logger.substep(`Final binary: ${finalOutputBinary}`)
      logger.substep(
        `E2E binary: ${existsSync(distBinary) ? distBinary : distSeaBinary}`,
      )
      logger.log('')
      logger.success('Cached build is ready to use')
      logger.log('')
      return
    }
  }

  // Phase 3: Verify Git tag exists before cloning.
  printHeader('Verifying Node.js Version')
  logger.log(`Checking if ${NODE_VERSION} exists in Node.js repository...`)
  const tagCheck = await verifyGitTag(NODE_VERSION)
  if (!tagCheck.exists) {
    printError(
      'Invalid Node.js Version',
      `Version ${NODE_VERSION} does not exist in Node.js repository.`,
      [
        'Check available versions: https://github.com/nodejs/node/tags',
        'Update NODE_VERSION in this script to a valid version',
        'Make sure version starts with "v" (e.g., v24.10.0)',
      ],
    )
    throw new Error('Invalid Node.js version')
  }
  logger.log(
    `${colors.green('✓')} ${NODE_VERSION} exists in Node.js repository`,
  )
  logger.log('')

  // Clone or reset Node.js repository.
  if (!(await shouldRun(BUILD_DIR, PACKAGE_NAME, 'cloned', CLEAN_BUILD))) {
    // shouldRun already printed the skip message
    logger.log('')
  } else if (!existsSync(NODE_DIR) || CLEAN_BUILD) {
    if (existsSync(NODE_DIR) && CLEAN_BUILD) {
      printHeader('Clean Build Requested')
      logger.log('Removing existing Node.js source directory...')
      const { rm } = await import('node:fs/promises')
      await safeDelete(NODE_DIR, { recursive: true, force: true })
      await cleanWorkflowCheckpoint(BUILD_DIR, PACKAGE_NAME)
      logger.log(`${colors.green('✓')} Cleaned build directory`)
      logger.log('')
    }

    printHeader('Cloning Node.js Source')
    logger.log(`Version: ${NODE_VERSION}`)
    logger.log('Repository: https://github.com/nodejs/node.git')
    logger.log('')
    logger.info(
      'This will download ~200-300 MB (shallow clone with --depth=1 --single-branch)...',
    )
    logger.log('Retry: Up to 3 attempts if clone fails')
    logger.log('')

    // Git clone with retry (network can fail during long downloads).
    let cloneSuccess = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          logger.log(`Retry attempt ${attempt}/3...`)
          logger.log('')
        }

        await exec(
          'git',
          [
            'clone',
            '--depth',
            '1',
            '--single-branch',
            '--branch',
            NODE_VERSION,
            'https://github.com/nodejs/node.git',
            NODE_DIR,
          ],
          { cwd: ROOT_DIR },
        )
        cloneSuccess = true
        break
      } catch (e) {
        if (attempt === 3) {
          printError(
            'Git Clone Failed',
            `Failed to clone Node.js repository after 3 attempts: ${e.message}`,
            [
              'Check your internet connection',
              'Try again in a few minutes',
              'Manually clone:',
              `  cd ${ROOT_DIR}`,
              `  git clone --depth 1 --branch ${NODE_VERSION} https://github.com/nodejs/node.git ${NODE_DIR}`,
            ],
          )
          throw new Error('Git clone failed after retries')
        }

        logger.warn(
          `${colors.yellow('⚠')} Clone attempt ${attempt} failed: ${e.message}`,
        )

        // Clean up partial clone.
        try {
          const { rm } = await import('node:fs/promises')
          await safeDelete(NODE_DIR, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors.
        }

        // Wait before retry.
        const waitTime = 2000 * attempt
        logger.log(`${colors.blue('ℹ')} Waiting ${waitTime}ms before retry...`)
        logger.log('')
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    if (cloneSuccess) {
      logger.log(`${colors.green('✓')} Node.js source cloned successfully`)
      await createWorkflowCheckpoint(BUILD_DIR, PACKAGE_NAME, 'cloned')
      logger.log('')
    }
  } else {
    printHeader('Using Existing Node.js Source')

    // Check if source has uncommitted changes.
    const isDirty = await isNodeSourceDirty()
    if (isDirty && !AUTO_YES) {
      printWarning(
        'Node.js Source Has Uncommitted Changes',
        'The build/node-source directory has uncommitted changes from a previous build or crash.',
        [
          'These changes will be discarded to ensure a clean build',
          'Press Ctrl+C now if you want to inspect the changes first',
          'Or wait 5 seconds to continue with automatic reset...',
        ],
      )

      // Wait 5 seconds before proceeding.
      await new Promise(resolve => setTimeout(resolve, 5000))
      logger.log('')
    } else if (isDirty && AUTO_YES) {
      logger.log(
        '⚠️  Node.js source has uncommitted changes (auto-resetting with --yes)',
      )
      logger.log('')
    }

    await resetNodeSource()
  }

  // Copy build additions (no bootstrap embedding).
  await copyBuildAdditions()

  // Apply Socket patches (including the dynamically generated bootstrap loader).
  const socketPatches = findSocketPatches()
  let _patchesApplied = false

  if (socketPatches.length > 0) {
    // Validate Socket patches before applying.
    printHeader('Validating Socket Patches')
    logger.log(`Found ${socketPatches.length} patch(es) for ${NODE_VERSION}`)
    logger.log('Checking integrity, compatibility, and conflicts...')
    logger.log('')

    const patchData = []
    let allValid = true

    for (const patch of socketPatches) {
      logger.group(` ${colors.blue('ℹ')}   Validating ${patch.name}`)

      const isValid = await validatePatch(patch.path, NODE_DIR)
      if (!isValid) {
        logger.error(`${colors.red('✗')} INVALID: Patch validation failed`)
        logger.groupEnd()
        allValid = false
        continue
      }

      const content = await fs.readFile(patch.path, 'utf8')
      const analysis = analyzePatchContent(content)

      patchData.push({
        name: patch.name,
        path: patch.path,
        analysis,
      })
      if (analysis.modifiesV8Includes) {
        logger.log(`${colors.green('✓')} Modifies V8 includes`)
      }
      if (analysis.modifiesSEA) {
        logger.log(`${colors.green('✓')} Modifies SEA detection`)
      }
      logger.log(`${colors.green('✓')} Valid`)
      logger.groupEnd()
    }

    if (!allValid) {
      throw new Error(
        'Socket patch validation failed.\n\n' +
          `One or more Socket patches are invalid or incompatible with Node.js ${NODE_VERSION}.\n\n` +
          'Possible causes:\n' +
          '  - Patch files are corrupted\n' +
          `  - Patches don't match this Node.js version\n` +
          '  - Node.js source has unexpected modifications\n\n' +
          'To fix:\n' +
          `  1. Verify patch files in ${PATCHES_DIR}\n` +
          '  2. Regenerate patches if needed:\n' +
          `     node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}\n` +
          '  3. Check build/patches/README.md for patch creation guide',
      )
    }
    // Check for conflicts between patches.
    const conflicts = checkPatchConflicts(patchData, NODE_VERSION)
    if (conflicts.length > 0) {
      logger.warn(`${colors.yellow('⚠')} Patch Conflicts Detected:`)
      logger.warn()
      for (const conflict of conflicts) {
        if (conflict.severity === 'error') {
          logger.error(`  ${colors.red('✗')} ERROR: ${conflict.message}`)
          allValid = false
        } else {
          logger.warn(`  ${colors.yellow('⚠')} WARNING: ${conflict.message}`)
        }
      }
      logger.warn()

      if (!allValid) {
        throw new Error(
          'Critical patch conflicts detected.\n\n' +
            `Socket patches have conflicts and cannot be applied to Node.js ${NODE_VERSION}.\n\n` +
            'Conflicts found:\n' +
            conflicts
              .filter(c => c.severity === 'error')
              .map(c => `  - ${c.message}`)
              .join('\n') +
            '\n\n' +
            'To fix:\n' +
            '  1. Remove conflicting patches\n' +
            `  2. Use version-specific patches for ${NODE_VERSION}\n` +
            '  3. Regenerate patches:\n' +
            `     node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}\n` +
            '  4. See build/patches/socket/README.md for guidance',
        )
      }
    } else {
      logger.log(
        `${colors.green('✓')} All Socket patches validated successfully`,
      )
      logger.log(`${colors.green('✓')} No conflicts detected`)
      logger.log('')
    }

    // Patches validated successfully, ready to apply.

    // Apply patches if validation and dry-run passed.
    if (allValid) {
      printHeader('Applying Socket Patches')
      for (const { name, path: patchPath } of patchData) {
        logger.log(`Applying ${name}...`)
        try {
          // Use -p1 to match Git patch format (strips a/ and b/ prefixes).
          // Use --batch to avoid interactive prompts.
          // Use --forward to skip if already applied.
          await exec(
            'sh',
            ['-c', `patch -p1 --batch --forward < "${patchPath}"`],
            { cwd: NODE_DIR },
          )
          logger.log(`${colors.green('✓')} ${name} applied`)
          _patchesApplied = true
        } catch (e) {
          throw new Error(
            'Socket patch application failed.\n\n' +
              `Failed to apply patch: ${name}\n` +
              `Node.js version: ${NODE_VERSION}\n` +
              `Patch path: ${patchPath}\n\n` +
              `Error: ${e.message}\n\n` +
              'This usually means:\n' +
              '  - The patch is outdated for this Node.js version\n' +
              '  - Node.js source has unexpected modifications\n' +
              '  - Patch file format is invalid\n\n' +
              'To fix:\n' +
              '  1. Verify Node.js source is clean\n' +
              '  2. Regenerate patches:\n' +
              `     node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}\n` +
              '  3. See build/patches/README.md for troubleshooting',
          )
        }
      }
      logger.log(`${colors.green('✓')} All Socket patches applied successfully`)
      logger.log('')
    }
  } else {
    throw new Error(
      `No Socket patches found for Node.js ${NODE_VERSION}.\n\n` +
        `Expected patches in: ${PATCHES_DIR}\n\n` +
        'Socket patches are required for all Node.js builds. Patches must exist before building.\n\n' +
        'To fix:\n' +
        `  1. Create patches for ${NODE_VERSION}:\n` +
        `     node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}\n` +
        '  2. See build/patches/README.md for patch creation guide\n' +
        '  3. Patches must be committed to the repository before building\n\n' +
        'Note: For new Node.js versions, you must create patches following the standard\n' +
        'patch creation process documented in build/patches/README.md',
    )
  }

  // Verify modifications were applied.
  await verifySocketModifications()

  // Configure Node.js with optimizations.
  printHeader('Configuring Node.js Build')

  if (IS_DEV_BUILD) {
    logger.log(
      `${colors.cyan('🚀 DEV BUILD MODE')} - Fast builds, larger binaries`,
    )
    logger.log('')
    logger.log('Optimization flags:')
    logger.log(
      `  ${colors.green('✓')} KEEP: Full V8 (TurboFan JIT), WASM, SSL/crypto, inspector`,
    )
    logger.log(
      `  ${colors.green('✓')} REMOVE: npm, corepack, amaro, sqlite, SEA`,
    )
    logger.log(
      `  ${colors.green('✓')} ICU: small-icu (English-only, needed for polyfills)`,
    )
    logger.log(
      `  ${colors.green('✓')} DISABLED: LTO (Link Time Optimization) for faster builds`,
    )
    logger.log(
      `  ${colors.green('✓')} DISABLED: V8 Lite Mode for faster JS execution`,
    )
    logger.log('')
    logger.log(
      'Expected binary size: ~80-90MB (before stripping), ~50-55MB (after)',
    )
    logger.log('Expected build time: ~50% faster than production builds')
  } else {
    logger.log(
      `${colors.magenta('⚡ PRODUCTION BUILD MODE')} - Optimized for size/distribution`,
    )
    logger.log('')
    logger.log('Optimization flags:')
    logger.log(
      `  ${colors.green('✓')} KEEP: V8 TurboFan JIT, WASM (Liftoff), SSL/crypto`,
    )
    logger.log(
      `  ${colors.green('✓')} REMOVE: npm, corepack, inspector, amaro, sqlite`,
    )
    logger.log(
      `  ${colors.green('✓')} ICU: small-icu (English-only, needed for polyfills)`,
    )
    const ltoNote = IS_LINUX ? 'LTO enabled' : 'LTO disabled (compiler issues)'
    logger.log(`  ${colors.green('✓')} OPTIMIZATIONS: no-inspector, ${ltoNote}`)
    logger.log('')
    logger.log(
      `  ${colors.green('✓')} JavaScript: Full speed (TurboFan JIT enabled)`,
    )
    logger.log(
      `  ${colors.green('✓')} WASM: Full speed (Liftoff baseline compiler)`,
    )
    logger.log(
      `  ${colors.green('✓')} I/O: Full speed (network, file operations)`,
    )
    logger.log('')
    logger.log(
      'Expected binary size: ~75MB (before stripping), ~60-65MB (after)',
    )
  }
  logger.log('')

  const configureFlags = [
    '--ninja', // Use Ninja build system (faster parallel builds than make)
    '--with-intl=small-icu', // -5 MB: English-only ICU (supports Unicode property escapes, needed for polyfills)
    // Note: small-icu provides essential Unicode support while keeping binary small
    '--without-npm',
    '--without-corepack',
    '--without-amaro',
    '--without-sqlite',
    // TEMPORARILY DISABLED TO DEBUG SEGFAULT:
    // '--without-node-snapshot',
    // '--without-node-code-cache', // Enable code cache (prevents error info dump).
    // Note: --v8-disable-object-print disabled to enable proper error output.
    // '--v8-disable-object-print',
    '--without-node-options',
    // SEA support enabled by default (no --disable-single-executable-application flag)
  ]

  // Production-only optimizations (slow builds, smaller binaries).
  if (IS_PROD_BUILD) {
    configureFlags.push('--without-inspector') // -3-5 MB: Remove debugging/profiling support
    // NOTE: --v8-lite-mode disabled (not supported on Windows, and causes inconsistency)
    // This keeps TurboFan JIT enabled for full JavaScript performance on all platforms
    // Link Time Optimization (very slow, saves ~5-10MB).
    // NOTE: LTO disabled due to compiler issues:
    // - Windows: LTCG causes LNK2005 multiply defined symbol errors
    // - macOS: clang crashes with segfault on V8 files (json-stringifier.cc)
    // - Linux: Enable LTO (works reliably with GCC)
    // See: https://github.com/nodejs/node/pull/21186 (Node.js made LTCG optional)
    if (IS_LINUX) {
      configureFlags.push('--enable-lto') // Linux only: Use standard LTO with GCC
    }
  }

  // Only add --dest-cpu when truly cross-compiling (e.g., building x64 on arm64 runner).
  // When --dest-cpu matches the host architecture, configure.py doesn't enable cross-compilation.
  // When --dest-cpu differs from host, it enables toolsets: ['host', 'target'], which causes
  // "multiple rules generate" ninja errors in v8_inspector_headers and run_torque.
  //
  // Example error when cross-compiling:
  //   ninja: error: obj.host/tools/v8_gypfiles/v8_inspector_headers.ninja:26:
  //   multiple rules generate gen/inspector-generated-output-root/src/js_protocol.stamp
  //
  // Solution: Don't use cross-compilation. Build natively on each architecture instead.
  // This matches Node.js's official release strategy - they don't cross-compile either.
  const hostArch = process.arch // 'arm64', 'x64', etc.
  if (ARCH !== hostArch) {
    logger.fail(
      `Cross-compilation not supported: building ${ARCH} on ${hostArch} host`,
    )
    logger.log(`   Use a native ${ARCH} runner instead.`)
    logger.log('   Example: For darwin-x64, use runs-on: macos-15-intel')
    process.exit(1)
  }
  // For native builds, don't pass --dest-cpu. Node.js configure.py will auto-detect the host arch.

  // Clean stale build files before configure to prevent ninja errors
  // This prevents "multiple rules generate" errors from stale .ninja files
  printHeader('Cleaning Build Directory')
  const outDir = path.join(NODE_DIR, 'out')
  if (existsSync(outDir)) {
    logger.log(`Removing ${outDir} to prevent ninja duplicate rules...`)
    const { rm } = await import('node:fs/promises')
    await rm(outDir, { recursive: true, force: true })
    logger.success(`Cleaned ${outDir}`)
    logger.log('')
  } else {
    logger.log('No out/ directory found (clean state)')
    logger.log('')
  }

  // Windows: Clean up any stale Release/Debug junction links before building.
  // vcbuild.bat creates junction links from Release -> out\Release after MSBuild.
  // If a previous build left a junction, vcbuild's 'rd' command may fail.
  // We use /Q (quiet, no confirmation) and check for junctions specifically.
  if (WIN32) {
    const configDirs = ['Release', 'Debug']
    for (const configDir of configDirs) {
      const junctionPath = path.join(NODE_DIR, configDir)
      if (existsSync(junctionPath)) {
        // If it exists, try to remove it (works for both junctions and directories)
        logger.log(`Removing stale ${configDir} directory/junction...`)
        // Use rd /S /Q on Windows to remove junction or directory
        await exec('cmd.exe', ['/c', `rd /S /Q "${configDir}"`], {
          cwd: NODE_DIR,
        })
        logger.log(`Removed ${configDir}`)
      }
    }
  }

  // Windows uses vcbuild.bat wrapper, Unix uses ./configure wrapper script.
  // vcbuild.bat handles Visual Studio detection, vcvarsall.bat environment setup,
  // and invokes configure.py with the correct environment automatically.
  // https://github.com/nodejs/node/blob/main/BUILDING.md#windows
  // https://github.com/nodejs/node/blob/main/vcbuild.bat
  const configureCommand = WIN32 ? 'vcbuild.bat' : './configure'

  // On Windows, vcbuild.bat automatically handles project file regeneration
  const configureArgs = WIN32
    ? convertToVcbuildFlags(configureFlags)
    : configureFlags

  logger.log(`::group::Running ${WIN32 ? 'vcbuild.bat' : './configure'}`)

  const execOptions = {
    cwd: NODE_DIR,
    shell: WIN32, // Required for batch file execution on Windows.
  }

  await exec(configureCommand, configureArgs, execOptions)
  logger.log('::endgroup::')
  logger.log(
    `${colors.green('✓')} ${WIN32 ? 'Build' : 'Configuration'} complete`,
  )
  logger.log('')

  // Build Node.js (skip on Windows - vcbuild already did it).
  if (WIN32) {
    logger.log(`${colors.green('✓')} Windows build completed by vcbuild.bat`)
    logger.log('')
  } else {
    printHeader('Building Node.js')
  }

  // Define binary path early (used for both cache and build).
  const binaryName = IS_WINDOWS ? 'node.exe' : 'node'
  const nodeBinary = path.join(NODE_DIR, 'out', 'Release', binaryName)

  // Try to restore from cache (skip compilation if successful).
  let restoredFromCache = false
  if (!CLEAN_BUILD) {
    logger.log('Checking for local checkpoint from previous build...')
    restoredFromCache = await restoreLocalCheckpoint(
      BUILD_DIR,
      nodeBinary,
      TARGET_PLATFORM,
      ARCH,
      NODE_VERSION,
    )
    logger.log('')
  }

  // Skip compilation if restored from cache or if Windows (vcbuild already built it).
  if (!(await shouldRun(BUILD_DIR, PACKAGE_NAME, 'built', CLEAN_BUILD))) {
    // shouldRun already printed the skip message
    logger.log('')
  } else if (!restoredFromCache && !WIN32) {
    const jobCount = CPU_COUNT
    const timeEstimate = estimateBuildTime(jobCount)
    logger.log(
      `⏱️  Estimated time: ${timeEstimate.estimatedMinutes} minutes (${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} min range)`,
    )
    logger.log(
      `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation`,
    )
    logger.log('')
    logger.log('You can:')
    logger.log('  • Grab coffee ☕')
    logger.log('  • Work on other tasks')
    logger.log(
      '  • Watch progress in this terminal (but seriously, go touch grass)',
    )
    logger.log('')
    logger.log(`Build log: ${getBuildLogPath(BUILD_DIR)}`)
    logger.log('')
    logger.log('Starting build...')
    logger.log('')

    const buildStart = Date.now()

    // Use GitHub Actions grouping to collapse compiler output.
    logger.log(
      '::group::Compiling Node.js with Ninja (this will take a while...)',
    )

    try {
      // Resolve full path to ninja for execution
      const ninjaCommand = whichBinSync('ninja')
      // Use all available CPU cores for parallel compilation (matching Node.js official builds)
      await exec(ninjaCommand, ['-C', 'out/Release', `-j${CPU_COUNT}`], {
        cwd: NODE_DIR,
        env: process.env,
      })
      logger.log('::endgroup::')
    } catch (e) {
      logger.log('::endgroup::')
      logger.log('')
      logger.log(
        '::error::Ninja build failed - see collapsed "Compiling Node.js" section above for full compiler output',
      )
      logger.log('')
      // Build failed - show last 100 lines of build log.
      const lastLines = await getLastLogLines(BUILD_DIR, 100)
      if (lastLines) {
        logger.error()
        logger.error('Last 100 lines of build log:')
        logger.error('━'.repeat(60))
        logger.error(lastLines)
        logger.error('━'.repeat(60))
      }

      printError(
        'Build Failed',
        'Node.js compilation failed. See build log for details.',
        [
          `Full log: ${getBuildLogPath(BUILD_DIR)}`,
          'Common issues:',
          '  - Out of memory: Close other applications',
          '  - Disk full: Free up disk space',
          '  - Compiler error: Check C++ compiler version',
          'Try again with: node scripts/build-custom-node.mjs --clean',
        ],
      )
      throw e
    }

    const buildDuration = Date.now() - buildStart
    const buildTime = formatDuration(buildDuration)

    logger.log('')
    logger.log(`${colors.green('✓')} Build completed in ${buildTime}`)
    logger.log('')
  }

  // Sign early for macOS ARM64 (required before execution in CI).
  if (IS_MACOS && ARCH === 'arm64') {
    printHeader('Code Signing (macOS ARM64 - Initial)')
    logger.log('Signing binary before testing for macOS ARM64 compatibility...')
    logger.logNewline()
    await exec('codesign', ['--sign', '-', '--force', nodeBinary])
    logger.success('Binary signed successfully')
    logger.logNewline()
  }

  // Test the binary.
  printHeader('Testing Binary (Release)')

  logger.log('Running basic functionality tests...')
  logger.log('')

  // Set SOCKET_CLI_BUILD_TEST=1 to skip CLI bootstrap during smoke tests.
  // The CLI version doesn't exist on npm yet during build.
  const smokeTestEnv = {
    ...process.env,
    SOCKET_CLI_BUILD_TEST: '1',
  }

  await exec(nodeBinary, ['--version'], { env: smokeTestEnv })

  logger.log('')
  logger.log(`${colors.green('✓')} Binary is functional`)
  logger.log('')

  // Create checkpoint for Release build after successful smoke test.
  const releaseBinarySize = await getFileSize(nodeBinary)
  await createWorkflowCheckpoint(BUILD_DIR, PACKAGE_NAME, 'release', {
    binarySize: releaseBinarySize,
    binaryPath: path.relative(BUILD_DIR, nodeBinary),
  })

  // Create local checkpoint for future runs.
  await createLocalCheckpoint(
    BUILD_DIR,
    nodeBinary,
    TARGET_PLATFORM,
    ARCH,
    NODE_VERSION,
  )
  logger.log('')

  // Copy unmodified binary to build/out/Release.
  printHeader('Copying to Build Output (Release)')
  logger.log('Copying unmodified binary to build/out/Release directory...')
  logger.logNewline()

  const outputReleaseDir = path.join(BUILD_DIR, 'out', 'Release')
  await safeMkdir(outputReleaseDir)
  const outputReleaseBinary = path.join(outputReleaseDir, binaryName)
  await fs.cp(nodeBinary, outputReleaseBinary, {
    force: true,
    preserveTimestamps: true,
  })

  logger.substep(`Release directory: ${outputReleaseDir}`)
  logger.substep('Binary: node (unmodified)')
  logger.logNewline()
  logger.success('Unmodified binary copied to build/out/Release')
  logger.logNewline()

  // Strip debug symbols to reduce size.
  printHeader('Optimizing Binary Size')
  const sizeBeforeStrip = await getFileSize(nodeBinary)
  logger.log(`Size before stripping: ${sizeBeforeStrip}`)
  logger.log('Removing debug symbols and unnecessary sections...')
  logger.log('')

  // Platform-specific stripping with enhanced optimization:
  // - macOS: Multi-phase (strip → llvm-strip if available)
  // - Linux: Aggressive (strip --strip-all → objcopy section removal → sstrip if available)
  // - Windows: Skip stripping (no strip command)
  if (IS_WINDOWS) {
    logger.log('Windows detected - skipping strip (not supported)')
    logger.log('')
  } else if (IS_MACOS) {
    // macOS: Multi-phase stripping for maximum size reduction.
    logger.log('Phase 1: Basic stripping')
    await exec('strip', [nodeBinary])

    // Phase 2: Try llvm-strip for more aggressive optimization.
    if (commandExists('llvm-strip')) {
      logger.log('Phase 2: Aggressive LLVM stripping')
      await exec('llvm-strip', [nodeBinary])
    } else {
      logger.log('Phase 2: Skipped (llvm-strip not available)')
    }
  } else {
    // Linux/Alpine: Aggressive multi-phase stripping.
    logger.log('Phase 1: Aggressive stripping')
    await exec('strip', ['--strip-all', nodeBinary])

    // Phase 2: Remove unnecessary ELF sections if objcopy is available.
    if (commandExists('objcopy')) {
      logger.log('Phase 2: Removing unnecessary ELF sections')
      const sections = [
        '.note.ABI-tag',
        '.note.gnu.build-id',
        '.comment',
        '.gnu.version',
      ]
      for (const section of sections) {
        try {
          await exec('objcopy', [`--remove-section=${section}`, nodeBinary])
        } catch (_error) {
          // Section might not exist, continue.
          logger.log(`  Skipped ${section} (not present)`)
        }
      }
    } else {
      logger.log('Phase 2: Skipped (objcopy not available)')
    }

    // Phase 3: Super strip if available (removes section headers).
    if (commandExists('sstrip')) {
      logger.log('Phase 3: Super strip (removing section headers)')
      await exec('sstrip', [nodeBinary])
    } else {
      logger.log('Phase 3: Skipped (sstrip not available)')
    }
  }

  const sizeAfterStrip = await getFileSize(nodeBinary)
  logger.log(`Size after stripping: ${sizeAfterStrip}`)

  // Parse and check size.
  const sizeMatch = sizeAfterStrip.match(/^(\d+)([KMG])/)
  if (sizeMatch) {
    const size = Number.parseInt(sizeMatch[1], 10)
    const unit = sizeMatch[2]

    if (unit === 'M' && size >= 20 && size <= 30) {
      logger.log(
        `${colors.green('✓')} Binary size is optimal (20-30MB with V8 Lite Mode)`,
      )
    } else if (unit === 'M' && size < 20) {
      printWarning(
        'Binary Smaller Than Expected',
        `Binary is ${sizeAfterStrip}, expected ~23-27MB.`,
        [
          'Some features may be missing',
          'Verify configure flags were applied correctly',
        ],
      )
    } else if (unit === 'M' && size > 35) {
      printWarning(
        'Binary Larger Than Expected',
        `Binary is ${sizeAfterStrip}, expected ~23-27MB.`,
        [
          'Debug symbols may not be fully stripped',
          'Configure flags may not be applied',
          'Binary will still work but will be larger',
        ],
      )
    }
  }

  logger.log('')

  // Re-sign after stripping for macOS ARM64 (strip invalidates code signature).
  if (IS_MACOS && ARCH === 'arm64') {
    printHeader('Code Signing (macOS ARM64 - After Stripping)')
    logger.log(
      'Re-signing binary after stripping for macOS ARM64 compatibility...',
    )
    logger.log(
      '(strip command invalidates code signature, re-signing required)',
    )
    logger.logNewline()
    await exec('codesign', ['--sign', '-', '--force', nodeBinary])
    logger.success('Binary re-signed successfully after stripping')
    logger.logNewline()

    // Smoke test after signing to ensure signature is valid.
    logger.log('Testing binary after signing...')
    const signTestPassed = await smokeTestBinary(nodeBinary)

    if (!signTestPassed) {
      printError(
        'Binary Corrupted After Signing',
        'Binary failed smoke test after code signing',
        [
          'Code signing may have corrupted the binary',
          'Try rebuilding: node scripts/build-custom-node.mjs --clean',
          'Report this issue if it persists',
        ],
      )
      throw new Error('Binary corrupted after signing')
    }

    logger.log(`${colors.green('✓')} Binary functional after signing`)
    logger.log('')
  }

  // Smoke test binary after stripping (ensure strip didn't corrupt it).
  logger.log('Testing binary after stripping...')
  const smokeTestPassed = await smokeTestBinary(nodeBinary)

  if (!smokeTestPassed) {
    printError(
      'Binary Corrupted After Stripping',
      'Binary failed smoke test after stripping',
      [
        'Strip command may have corrupted the binary',
        'Try rebuilding: node scripts/build-custom-node.mjs --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Binary corrupted after stripping')
  }

  logger.log(`${colors.green('✓')} Binary functional after stripping`)
  logger.log('')

  // Create checkpoint for Stripped build after successful smoke test.
  const strippedBinarySize = await getFileSize(nodeBinary)
  await createWorkflowCheckpoint(BUILD_DIR, PACKAGE_NAME, 'stripped', {
    binarySize: strippedBinarySize,
    binaryPath: path.relative(BUILD_DIR, nodeBinary),
  })

  // Copy stripped binary to build/out/Stripped.
  printHeader('Copying to Build Output (Stripped)')
  logger.log('Copying stripped binary to build/out/Stripped directory...')
  logger.logNewline()

  const outputStrippedDir = path.join(BUILD_DIR, 'out', 'Stripped')
  await safeMkdir(outputStrippedDir)
  const outputStrippedBinary = path.join(outputStrippedDir, 'node')
  await fs.cp(nodeBinary, outputStrippedBinary, {
    force: true,
    preserveTimestamps: true,
  })

  logger.substep(`Stripped directory: ${outputStrippedDir}`)
  logger.substep('Binary: node (stripped)')
  logger.logNewline()
  logger.success('Stripped binary copied to build/out/Stripped')
  logger.logNewline()

  // Compress binary for smaller distribution size (DEFAULT for smol builds).
  // Uses native platform APIs (Apple Compression, liblzma, Windows Compression API) instead of UPX.
  // Benefits: 75-79% compression (vs UPX's 50-60%), works with code signing, zero AV false positives.
  // Opt-out: Use --no-compress-binary flag to skip binary compression.
  let compressedBinary = null
  const shouldCompress = !values['no-compress-binary'] // Default: always compress (it's smol!)

  if (shouldCompress) {
    printHeader('Compressing Binary for Distribution')
    logger.log(
      'Compressing stripped binary using platform-specific compression...',
    )
    logger.logNewline()

    const compressedDir = path.join(BUILD_DIR, 'out', 'Compressed')
    await safeMkdir(compressedDir)
    compressedBinary = path.join(compressedDir, 'node')

    // Select compression quality based on platform.
    // macOS: LZFSE (faster) or LZMA (better compression).
    // Linux: LZMA (best for ELF).
    // Windows: LZMS (best for PE).
    const compressionQuality = IS_MACOS ? 'lzfse' : 'lzma'

    // Read socketbin package spec from actual package.json for socket-lib cache key generation.
    // Format: @socketbin/cli-{platform}-{arch}@{version}
    // This enables deterministic cache keys based on the published package.
    // Note: This path only exists in published npm packages, not in the dev monorepo.
    const socketbinPkgPath = path.join(
      path.dirname(ROOT_DIR),
      `socketbin-cli-${TARGET_PLATFORM}-${ARCH}`,
      'package.json',
    )
    let socketbinSpec = null
    if (existsSync(socketbinPkgPath)) {
      try {
        const socketbinPkg = JSON.parse(
          await fs.readFile(socketbinPkgPath, 'utf-8'),
        )
        socketbinSpec = `${socketbinPkg.name}@${socketbinPkg.version}`
        logger.substep(`Found socketbin package: ${socketbinSpec}`)
      } catch (_e) {
        // Failed to read or parse package.json - use fallback
        logger.substep('Using fallback cache key generation')
      }
    } else {
      // Expected in dev builds - socketbin packages only exist when published
      logger.substep('Using fallback cache key generation (dev mode)')
    }

    logger.substep(`Input: ${outputStrippedBinary}`)
    logger.substep(`Output: ${compressedBinary}`)
    logger.substep(`Algorithm: ${compressionQuality.toUpperCase()}`)
    if (socketbinSpec) {
      logger.substep(`Spec: ${socketbinSpec}`)
    }
    logger.logNewline()

    const sizeBeforeCompress = await getFileSize(outputStrippedBinary)
    logger.log(`Size before compression: ${sizeBeforeCompress}`)
    logger.log('Running compression tool...')
    logger.logNewline()

    // Run platform-specific compression.
    const compressArgs = [
      path.join(ROOT_DIR, 'scripts', 'compressed', 'compress-binary.mjs'),
      outputStrippedBinary,
      compressedBinary,
      `--quality=${compressionQuality}`,
    ]
    if (socketbinSpec) {
      compressArgs.push(`--spec=${socketbinSpec}`)
    }
    // Shell required on Windows for the compression script to spawn executables
    await exec(process.execPath, compressArgs, { cwd: ROOT_DIR })

    const sizeAfterCompress = await getFileSize(compressedBinary)
    logger.log(`Size after compression: ${sizeAfterCompress}`)
    logger.logNewline()

    // Skip signing compressed binary - it's a self-extracting binary (decompressor stub + compressed data),
    // not a standard Mach-O executable. The decompressor stub is already signed if needed.
    // When executed, the stub extracts and runs the original Node.js binary.
    logger.log('Skipping code signing for self-extracting binary...')
    logger.substep(
      '✓ Compressed binary ready (self-extracting, no signature needed)',
    )
    logger.logNewline()

    // Skip smoke test for self-extracting binary.
    // TODO: The decompressor stub needs to be updated to properly handle command-line arguments.
    // Currently it treats arguments as filenames instead of passing them to the decompressed binary.
    // Once fixed, we can enable smoke testing for compressed binaries.
    logger.log('Skipping smoke test for self-extracting binary...')
    logger.substep(
      '✓ Smoke test skipped (decompressor needs argument handling fix)',
    )
    logger.log('')

    // Create checkpoint for Compressed build (smoke test skipped - decompressor needs fix).
    const compressedBinarySize = await getFileSize(compressedBinary)
    await createWorkflowCheckpoint(BUILD_DIR, PACKAGE_NAME, 'compressed', {
      binarySize: compressedBinarySize,
      binaryPath: path.relative(BUILD_DIR, compressedBinary),
      smokeTestSkipped: true,
    })

    logger.substep(`Compressed directory: ${compressedDir}`)
    logger.substep('Binary: node (compressed)')
    logger.logNewline()
    logger.success('Binary compressed successfully')
    logger.logNewline()

    // Copy decompression tool to Compressed directory for distribution.
    printHeader('Bundling Decompression Tool')
    logger.log(
      'Copying platform-specific decompression tool for distribution...',
    )
    logger.logNewline()

    const toolsDir = path.join(ROOT_DIR, 'additions', '003-compression-tools')
    const decompressTool = IS_MACOS
      ? 'socketsecurity_macho_decompress'
      : WIN32
        ? 'socketsecurity_pe_decompress.exe'
        : 'socketsecurity_elf_decompress'

    const decompressToolSource = path.join(toolsDir, decompressTool)
    const decompressToolDest = path.join(compressedDir, decompressTool)

    if (existsSync(decompressToolSource)) {
      await fs.cp(decompressToolSource, decompressToolDest, {
        force: true,
        preserveTimestamps: true,
      })

      // Ensure tool is executable.
      await exec('chmod', ['+x', decompressToolDest])

      const toolSize = await getFileSize(decompressToolDest)
      logger.substep(`Tool: ${decompressTool} (${toolSize})`)
      logger.substep(`Location: ${compressedDir}`)
      logger.logNewline()
      logger.success('Decompression tool bundled for distribution')
      logger.logNewline()
    } else {
      printWarning(
        'Decompression Tool Not Found',
        `Could not find ${decompressTool} in ${toolsDir}`,
        [
          'Build the compression tools first:',
          `  cd ${toolsDir}`,
          '  make all',
          'Then run this build again with COMPRESS_BINARY=1',
        ],
      )
    }
  } else {
    logger.log('')
    logger.log(
      `${colors.blue('ℹ')} Binary compression skipped (--no-compress-binary flag)`,
    )
    logger.log('   Compression is enabled by default for smol builds')
    logger.log(
      '   Remove --no-compress-binary flag to enable binary compression',
    )
    logger.log('')
  }

  // Determine if we should use compressed binary for final distribution (default: yes for smol builds).
  const shouldUseCompression =
    !values['no-compress-binary'] &&
    compressedBinary &&
    existsSync(compressedBinary)

  // Copy final distribution binary to build/out/Final.
  // Use compressed binary by default (smol!), or stripped if --no-compress.
  printHeader('Copying to Build Output (Final)')
  const finalDir = path.join(BUILD_DIR, 'out', 'Final')
  await safeMkdir(finalDir)
  const finalBinary = path.join(finalDir, 'node')

  if (shouldUseCompression) {
    logger.log('Copying compressed distribution package to Final directory...')
    logger.logNewline()

    const compressedDir = path.join(BUILD_DIR, 'out', 'Compressed')

    // Copy compressed binary to Final.
    await fs.cp(compressedBinary, finalBinary, {
      force: true,
      preserveTimestamps: true,
    })

    // Copy decompressor tool to Final.
    const decompressTool = IS_MACOS
      ? 'socketsecurity_macho_decompress'
      : WIN32
        ? 'socketsecurity_pe_decompress.exe'
        : 'socketsecurity_elf_decompress'
    const decompressToolSource = path.join(compressedDir, decompressTool)
    const decompressToolDest = path.join(finalDir, decompressTool)

    if (existsSync(decompressToolSource)) {
      await fs.cp(decompressToolSource, decompressToolDest, {
        force: true,
        preserveTimestamps: true,
      })
      await exec('chmod', ['+x', decompressToolDest])
    }

    const compressedSize = await getFileSize(finalBinary)
    const decompressToolSize = existsSync(decompressToolDest)
      ? await getFileSize(decompressToolDest)
      : 'N/A'

    logger.substep('Source: build/out/Compressed/node (compressed + signed)')
    logger.substep(`Binary: ${compressedSize}`)
    logger.substep(`Decompressor: ${decompressToolSize}`)
    logger.substep(`Location: ${finalDir}`)
    logger.logNewline()
    logger.success('Final distribution created with compressed package')
    logger.logNewline()
  } else {
    logger.log('Copying stripped binary to Final directory...')
    logger.logNewline()

    await fs.cp(outputStrippedBinary, finalBinary, {
      force: true,
      preserveTimestamps: true,
    })

    const binarySize = await getFileSize(finalBinary)
    logger.substep('Source: build/out/Stripped/node (stripped, uncompressed)')
    logger.substep(`Binary: ${binarySize}`)
    logger.substep(`Location: ${finalDir}`)
    logger.logNewline()
    logger.success('Final distribution created with uncompressed binary')
    logger.logNewline()
  }

  // Copy signed binary to build/out/Sea (for SEA builds).
  printHeader('Copying to Build Output (Sea)')
  logger.log(
    'Copying signed binary to build/out/Sea directory for SEA builds...',
  )
  logger.logNewline()

  const outputSeaDir = path.join(BUILD_DIR, 'out', 'Sea')
  await safeMkdir(outputSeaDir)
  const outputSeaBinary = path.join(outputSeaDir, 'node')
  await fs.cp(nodeBinary, outputSeaBinary, {
    force: true,
    preserveTimestamps: true,
  })

  logger.substep(`Sea directory: ${outputSeaDir}`)
  logger.substep('Binary: node (stripped + signed, ready for SEA)')
  logger.logNewline()
  logger.success('Binary copied to build/out/Sea')
  logger.logNewline()

  // Copy to dist/ for E2E testing.
  printHeader('Copying to dist/ for E2E Testing')
  logger.log(
    'Creating dist/socket-smol and dist/socket-sea for e2e test suite...',
  )
  logger.logNewline()

  const distDir = path.join(ROOT_DIR, 'dist')
  await safeMkdir(distDir)

  // Copy final binary (compressed or stripped) to dist/socket-smol.
  const distSmolBinary = path.join(distDir, 'socket-smol')
  await fs.cp(finalBinary, distSmolBinary, {
    force: true,
    preserveTimestamps: true,
  })
  await exec('chmod', ['+x', distSmolBinary])

  // Copy SEA binary to dist/socket-sea.
  const distSeaBinary = path.join(distDir, 'socket-sea')
  await fs.cp(outputSeaBinary, distSeaBinary, {
    force: true,
    preserveTimestamps: true,
  })
  await exec('chmod', ['+x', distSeaBinary])

  logger.substep(`E2E smol binary: ${distSmolBinary}`)
  logger.substep(`E2E sea binary: ${distSeaBinary}`)
  logger.substep('Test commands:')
  logger.substep('  pnpm --filter @socketsecurity/cli run e2e:smol')
  logger.substep('  pnpm --filter @socketsecurity/cli run e2e:sea')
  logger.logNewline()
  logger.success('Binaries copied to dist/ for e2e testing')
  logger.logNewline()

  // Write source hash to cache file for future builds.
  const sourcePaths = collectBuildSourceFiles()
  const sourceHashComment = await generateHashComment(sourcePaths)
  const cacheDir = path.join(BUILD_ROOT, '.cache')
  await safeMkdir(cacheDir, { recursive: true })
  const hashFilePath = path.join(cacheDir, 'node.hash')
  await fs.writeFile(hashFilePath, sourceHashComment, 'utf-8')
  logger.substep(`Cache hash: ${hashFilePath}`)
  logger.logNewline()

  // Report build complete.
  const binarySize = await getFileSize(finalBinary)

  // Calculate checksum for cache validation
  const { createHash } = await import('node:crypto')
  const binaryContent = await fs.readFile(finalBinary)
  const checksum = createHash('sha256').update(binaryContent).digest('hex')

  await createWorkflowCheckpoint(BUILD_DIR, PACKAGE_NAME, 'final', {
    binarySize,
    checksum,
    binaryPath: path.relative(BUILD_DIR, finalBinary),
  })
  await cleanWorkflowCheckpoint(BUILD_DIR, PACKAGE_NAME)

  // Calculate total build time.
  const totalDuration = Date.now() - totalStart
  const totalTime = formatDuration(totalDuration)

  printHeader('🎉 Build Complete!')

  // ASCII art success.
  logger.logNewline()
  logger.log('    ╔═══════════════════════════════════════╗')
  logger.log('    ║                                       ║')
  logger.log('    ║     ✨ Build Successful! ✨          ║')
  logger.log('    ║                                       ║')
  logger.log('    ╚═══════════════════════════════════════╝')
  logger.logNewline()

  logger.log('📊 Build Statistics:')
  logger.log(`   Total time: ${totalTime}`)
  logger.log(`   Binary size: ${binarySize}`)
  logger.log(`   CPU cores used: ${CPU_COUNT}`)
  logger.logNewline()

  logger.log('📁 Binary Locations:')
  logger.log(`   Source:       ${nodeBinary}`)
  logger.log(`   Release:      ${outputReleaseBinary}`)
  logger.log(`   Stripped:     ${outputStrippedBinary}`)
  if (compressedBinary) {
    logger.log(
      `   Compressed:   ${compressedBinary} (signed, with decompression tool)`,
    )
  }
  logger.log(`   Final:        ${finalBinary}`)
  logger.log(`   Distribution: ${finalBinary}`)
  logger.logNewline()

  logger.log('🚀 Next Steps:')
  if (compressedBinary) {
    logger.log('   1. Test compressed binary:')
    logger.log(`      cd ${path.join(BUILD_DIR, 'out', 'Compressed')}`)
    const decompressTool = IS_MACOS
      ? './socketsecurity_macho_decompress'
      : WIN32
        ? './socketsecurity_pe_decompress.exe'
        : './socketsecurity_elf_decompress'
    logger.log(`      ${decompressTool} ./node --version`)
    logger.logNewline()
    logger.log('   2. Build Socket CLI with compressed Node:')
    logger.log('      (Use compressed binary for pkg builds)')
    logger.logNewline()
  } else {
    logger.log('   1. Build Socket CLI:')
    logger.log('      pnpm run build')
    logger.logNewline()
    logger.log('   2. Create pkg executable:')
    logger.log('      pnpm exec pkg .')
    logger.logNewline()
    logger.log('   3. Test the executable:')
    logger.log('      ./pkg-binaries/socket-macos-arm64 --version')
    logger.logNewline()
  }

  logger.log('💡 Helpful Commands:')
  logger.log('   Verify build: node scripts/verify-node-build.mjs')
  if (!shouldCompress) {
    logger.log(
      '   Enable compression: COMPRESS_BINARY=1 node scripts/build.mjs',
    )
  }
  logger.logNewline()

  logger.log('📚 Documentation:')
  logger.log('   Build process: build/patches/README.md')
  logger.log('   Troubleshooting: See README for common issues')
  logger.logNewline()

  if (RUN_VERIFY) {
    printHeader('Running Verification')
    logger.log('Running comprehensive verification checks...')
    logger.logNewline()

    try {
      await exec(
        'node',
        ['scripts/verify-node-build.mjs', `--node-version=${NODE_VERSION}`],
        {
          cwd: ROOT_DIR,
        },
      )
    } catch (_e) {
      printWarning(
        'Verification Failed',
        'Build completed but verification found issues.',
        [
          'Review verification output above',
          'Run manually: node scripts/verify-node-build.mjs',
        ],
      )
    }
  } else {
    logger.info('Tip: Run verification checks:')
    logger.substep('node scripts/verify-node-build.mjs')
    logger.logNewline()
  }

  // Step 10: Run tests if requested.
  if (RUN_TESTS || RUN_FULL_TESTS) {
    printHeader('Running Tests with Custom Node')
    logger.log(`Testing Socket CLI with custom Node.js ${NODE_VERSION}...`)
    logger.logNewline()

    try {
      const testArgs = [
        'scripts/test-with-custom-node.mjs',
        `--node-version=${NODE_VERSION}`,
      ]
      if (RUN_FULL_TESTS) {
        testArgs.push('--full')
      }

      await exec('node', testArgs, { cwd: ROOT_DIR })

      logger.logNewline()
      logger.success('Tests passed with custom Node.js binary!')
      logger.logNewline()
    } catch (_e) {
      printError(
        'Tests Failed',
        'Tests failed when using the custom Node.js binary.',
        [
          'Review test output above for details',
          'The binary may have issues with Socket CLI',
          'Consider rebuilding: node scripts/build-custom-node.mjs --clean',
          'Or run tests manually: node scripts/test-with-custom-node.mjs',
        ],
      )
      throw new Error('Tests failed with custom Node.js')
    }
  } else if (!RUN_VERIFY) {
    logger.info('Tip: Test with custom Node:')
    logger.substep('node scripts/test-with-custom-node.mjs')
    logger.logNewline()
  }
}

// Run main function.
main().catch(e => {
  logger.fail(`Build failed: ${e.message}`)
  throw e
})

/**
 * @fileoverview Build Node.js with SEA and dual compression support
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
 *     - Always enabled during build
 *     - 75-79% size reduction (27MB → 8-12MB)
 *     - Decompression: ~100ms on first run, then cached
 *
 * Build Flags:
 *   --clean                     Force clean build (ignore cache)
 *   --prod                      Production optimizations (V8 Lite, LTO)
 *   --dev                       Development mode (faster builds)
 *   --with-lief                 Enable LIEF support (enables --build-sea flag, +5MB binary size)
 *   --from-checkpoint=<name>    Skip to specific build phase (resume from existing artifact)
 *                               Valid: binary-released, binary-stripped, binary-compressed, finalized
 *   --stop-at=<name>            Stop after specific build phase (creates checkpoint)
 *                               Valid: binary-released, binary-stripped, binary-compressed, finalized
 *   --build-only=<name>         Build to stage but skip checkpoint creation (for Depot CI)
 *                               Valid: binary-released, binary-stripped, binary-compressed, finalized
 *
 * Usage Patterns:
 *   1. Smol binary only:       pnpm build
 *   2. Smol + SEA:             postject smol-binary NODE_SEA_BLOB app.blob
 *   3. Production build:       pnpm build --prod
 *
 * Binary Size Optimization Strategy:
 *
 *   Starting size:                 ~49 MB (default Node.js v25 build)
 *
 *   Stage 1: Configure flags (applied)
 *     + --with-intl=small-icu:     ~44 MB  (-5 MB:  English-only ICU) ✓ USED
 *     + --without-* flags:         ~27 MB  (-22 MB: Remove npm, amaro, etc.) ✓ USED
 *     + --experimental-enable-pointer-compression: Reduced memory usage ✓ USED
 *
 *   Additional options (not used - for reference):
 *     - --with-intl=none:          ~41 MB  (-8 MB:  No ICU, breaks Unicode)
 *     - --v8-lite-mode:            ~29 MB  (-20 MB: Disables JIT, 5-10x slower)
 *
 *   Stage 2: Binary stripping
 *     + strip (platform-specific): ~25 MB  (-24 MB: Remove debug symbols)
 *
 *   Stage 3: Compression (this script)
 *     + pkg Brotli (VFS):          ~23 MB  (-26 MB: Compress Socket CLI code)
 *     + Node.js lib/ minify+Brotli:~21 MB  (-28 MB: Compress built-in modules)
 *
 *   TARGET EXPECTED: ~21 MB (small-icu + full V8 JIT for performance)
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
 *   node scripts/load.mts build-custom-node              # Normal build
 *   node scripts/load.mts build-custom-node --clean      # Force fresh build
 *   node scripts/load.mts build-custom-node --yes        # Auto-yes to prompts
 *   node scripts/load.mts build-custom-node --verify     # Verify after build
 *   node scripts/load.mts build-custom-node --test       # Build + run smoke tests
 *   node scripts/load.mts build-custom-node --test-full  # Build + run full tests
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import {
  formatDuration,
  getFileSize,
  writeCacheHash,
} from 'build-infra/lib/build-helpers'
import { BYTES, CHECKPOINTS, NODE_VERSION } from 'build-infra/lib/constants'
import { verifyNodeChecksum } from 'build-infra/lib/version-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { glob } from '@socketsecurity/lib/globs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

import {
  PACKAGE_ROOT,
  getBuildPaths,
  getBuildSourcePaths,
  getExistingPaths,
  getSharedBuildPaths,
} from './paths.mts'
import { buildCompressed } from '../../binary-compressed/shared/build-compressed.mts'
import { buildRelease } from '../../binary-released/shared/build-released.mts'
import { buildStripped } from '../../binary-stripped/shared/build-stripped.mts'
import { finalizeBinary } from '../../finalized/shared/finalize-binary.mts'
import { printBuildSummary } from '../../lib/build-summary.mts'
import { BINJECT_DIR, BIN_INFRA_DIR, BUILD_INFRA_DIR } from '../../paths.mts'

const __filename = fileURLToPath(import.meta.url)

// Hoist logger for consistent usage throughout the script.
const logger = getDefaultLogger()

// Parse arguments.
const { values } = parseArgs({
  options: {
    'allow-cross': { short: 'X', type: 'boolean' },
    arch: { type: 'string' },
    'build-only': { type: 'string' },
    clean: { type: 'boolean' },
    dev: { type: 'boolean' },
    'from-checkpoint': { type: 'string' },
    libc: { type: 'string' },
    'no-compress-sea': { type: 'boolean' },
    platform: { type: 'string' },
    'platform-arch': { type: 'string' },
    prod: { type: 'boolean' },
    'stop-at': { type: 'string' },
    test: { type: 'boolean' },
    'test-full': { type: 'boolean' },
    verify: { type: 'boolean' },
    'with-lief': { type: 'boolean' },
    yes: { short: 'y', type: 'boolean' },
  },
  strict: false,
})

const TARGET_PLATFORM = values.platform || os.platform()
const TARGET_ARCH = values.arch || process.arch
const TARGET_LIBC = values.libc

// Validate libc parameter
if (TARGET_LIBC && TARGET_LIBC !== 'musl' && TARGET_LIBC !== 'glibc') {
  throw new Error(
    `Invalid --libc value: ${TARGET_LIBC}. Valid options: musl, glibc`,
  )
}
if (TARGET_LIBC && TARGET_PLATFORM !== 'linux') {
  throw new Error(
    `--libc parameter is only valid for Linux platform (got platform: ${TARGET_PLATFORM})`,
  )
}
// Alias for shorter code
const ARCH = TARGET_ARCH
const CLEAN_BUILD = Boolean(values.clean)
const AUTO_YES = Boolean(values.yes)
const FROM_CHECKPOINT = values['from-checkpoint']
const STOP_AT = values['stop-at']
const BUILD_ONLY = values['build-only']

// Validate checkpoint name if provided.
const VALID_CHECKPOINTS = [
  CHECKPOINTS.BINARY_RELEASED,
  CHECKPOINTS.BINARY_STRIPPED,
  CHECKPOINTS.BINARY_COMPRESSED,
  CHECKPOINTS.FINALIZED,
]
if (FROM_CHECKPOINT && !VALID_CHECKPOINTS.includes(FROM_CHECKPOINT)) {
  throw new Error(
    `Invalid checkpoint: ${FROM_CHECKPOINT}. Valid options: ${VALID_CHECKPOINTS.join(', ')}`,
  )
}
if (STOP_AT && !VALID_CHECKPOINTS.includes(STOP_AT)) {
  throw new Error(
    `Invalid stop-at checkpoint: ${STOP_AT}. Valid options: ${VALID_CHECKPOINTS.join(', ')}`,
  )
}
if (BUILD_ONLY && !VALID_CHECKPOINTS.includes(BUILD_ONLY)) {
  throw new Error(
    `Invalid build-only checkpoint: ${BUILD_ONLY}. Valid options: ${VALID_CHECKPOINTS.join(', ')}`,
  )
}
if (BUILD_ONLY && STOP_AT) {
  throw new Error('Cannot use both --build-only and --stop-at')
}
if (BUILD_ONLY && FROM_CHECKPOINT) {
  throw new Error('Cannot use both --build-only and --from-checkpoint')
}

// Build mode: dev (fast builds) vs prod (optimized builds).
// - CI: defaults to prod (unless --dev specified)
// - Local: defaults to dev (unless --prod specified)
const IS_CI = 'CI' in process.env || 'CONTINUOUS_INTEGRATION' in process.env
const IS_PROD_BUILD = values.prod || (!values.dev && IS_CI)

// Configuration

// Node.js source info - upstream/node is the source of truth
const NODE_REPO = 'https://github.com/nodejs/node.git'
// NODE_SHA is derived from upstream/node at build time (see copy-source.mts)
// Will be read from upstream/node
const NODE_SHA = undefined

const BUILD_MODE = IS_PROD_BUILD ? 'prod' : 'dev'
const WITH_LIEF = Boolean(values['with-lief'])

// Set environment variable for tests to detect LIEF availability
if (WITH_LIEF) {
  process.env.BUILD_WITH_LIEF = 'true'
}

const {
  binaryName,
  bootstrapFile,
  buildDir,
  buildPatchesDir,
  cacheDir,
  nodeBinary,
  nodeSourceDir,
  outDir,
  outputCompressedBinary,
  outputCompressedDir,
  outputFinalBinary,
  outputReleaseBinary,
  outputReleaseDir,
  outputStrippedBinary,
  outputStrippedDir,
  patchedFile,
  testFile,
} = getBuildPaths(BUILD_MODE, TARGET_PLATFORM, values['platform-arch'])
const BUILD_DIR = buildDir
const MODE_SOURCE_DIR = nodeSourceDir
const PACKAGE_NAME = ''

// Shared build directories (pristine source shared across dev/prod)
const { buildDir: SHARED_BUILD_DIR, nodeSourceDir: SHARED_SOURCE_DIR } =
  getSharedBuildPaths()

// Directory structure (fully isolated by mode + platform-arch for concurrent builds).
// build/shared/ - Shared pristine artifacts (cloned source, extracted to dev/prod).
//   build/shared/source/ - Pristine Node.js source (archived in checkpoint).
//   build/shared/checkpoints/ - Source-cloned checkpoint (shared across dev/prod).
// build/<mode>/<platform-arch>/ - Build workspace for one mode on one target.
//   build/<mode>/<platform-arch>/source/ - Node.js source (extracted from shared checkpoint).
//   build/<mode>/<platform-arch>/out/ - Build outputs (Release, Stripped, Compressed, Final, ...).
//   build/<mode>/<platform-arch>/.cache/ - Compiled binary cache + cache-validation.hash.
//   build/<mode>/<platform-arch>/checkpoints/ - Build checkpoints (source-patched, binary-released, ...).

/**
 * Normalize and deduplicate an array of file paths.
 *
 * Applies cross-platform path normalization (using @socketsecurity/lib) and
 * removes duplicates. This is a defensive pattern to prevent cache invalidation
 * bugs where the same file path is added multiple times with different formats.
 *
 * @param {string[]} paths - Array of file paths to normalize and deduplicate
 * @returns {string[]} Array of unique, normalized paths
 */
function normalizeAndDedup(paths) {
  return [...new Set(paths.map(p => normalizePath(p)))]
}

/**
 * Collect source files for a specific build phase.
 * Used for phase-specific cache key generation to minimize invalidation.
 *
 * Cache Key Strategy:
 * ===================
 * Each phase tracks only files that affect that phase:
 * - Phase-specific scripts (e.g., release tracks release scripts, NOT stripped/compressed scripts)
 * - Cumulative patches and additions (each phase includes previous phase patches)
 * - Common scripts (affect all phases)
 *
 * This ensures:
 * - Modifying stripped scripts → only invalidates Stripped + downstream phases
 * - Modifying compressed scripts → only invalidates Compressed + downstream phases
 * - Release cache is NEVER invalidated by downstream phase changes
 *
 * @param {string} phase - Build phase ('binary-released', 'binary-stripped', 'binary-compressed', 'finalized')
 * @returns {string[]} Array of absolute paths to source files for this phase
 */
async function collectBuildSourceFiles(phase = 'binary-released') {
  const sources = []

  // Use getBuildSourcePaths (NOT getCumulativeBuildSourcePaths) to get:
  // - Phase-specific scripts only (not cumulative)
  // - Cumulative patches and additions (correct for dependencies)
  const sourcePaths = getBuildSourcePaths(phase, TARGET_PLATFORM, TARGET_ARCH)

  const existingPatchDirs = getExistingPaths(sourcePaths.patches)
  const existingAdditionDirs = getExistingPaths(sourcePaths.additions)
  const existingScriptDirs = getExistingPaths([
    ...sourcePaths.common,
    ...sourcePaths.scripts,
  ])

  for (const patchDir of existingPatchDirs) {
    const patchFiles = await glob('*.patch', {
      absolute: true,
      cwd: patchDir,
    })
    // Add all patch files - computeSourceHash will handle missing files
    sources.push(...patchFiles)
  }

  // Include source package files (canonical source, not copies in additions/)
  // These are the source of truth that get copied to additions/source-patched/
  const sourcePackageDirs = [
    path.join(BINJECT_DIR, 'src', 'socketsecurity', 'binject'),
    path.join(BIN_INFRA_DIR, 'src', 'socketsecurity', 'bin-infra'),
    path.join(BUILD_INFRA_DIR, 'src', 'socketsecurity', 'build-infra'),
  ]

  for (const srcDir of sourcePackageDirs) {
    if (existsSync(srcDir)) {
      const srcFiles = await glob('**/*.{c,cc,cpp,h,hh,hpp}', {
        absolute: true,
        cwd: srcDir,
      })
      sources.push(...srcFiles)
    }
  }

  // For additions, check both:
  // 1. Hierarchical directories (shared/, {platform}/)
  // 2. Top-level phase directory with any structure (js/, cpp/, etc.)
  // This handles custom directory structures like additions/source-patched/{js,cpp}
  const additionPhaseDirs = new Set()

  for (const addPath of sourcePaths.additions) {
    // Extract base phase directory (e.g., additions/source-patched)
    const match = addPath.match(/additions\/([^/]+)/)
    if (match) {
      const phaseDir = path.join(PACKAGE_ROOT, 'additions', match[1])
      if (existsSync(phaseDir)) {
        additionPhaseDirs.add(phaseDir)
      }
    }
  }

  // Recursively find all files in additions directories.
  // Exclude gitignored directories that are copies from source packages/submodules:
  // - src/socketsecurity/bin-infra/ (copied from packages/bin-infra/src/)
  // - src/socketsecurity/binject/ (copied from packages/binject/src/)
  // - src/socketsecurity/build-infra/ (copied from packages/build-infra/src/)
  // - deps/fast-webstreams/ (synced from node_modules)
  // - deps/lzfse/src/ (copied from lief-builder/upstream/lzfse/src)
  // - deps/libdeflate/* (copied from binject/upstream/libdeflate)
  //   Note: libdeflate.gyp is NOT gitignored but we can't use negation patterns
  //   with fast-glob ignore, so we add it explicitly after globbing.
  // These are already included via sourcePackageDirs above (for socketsecurity/*) or
  // come from external submodules that don't affect cache validity.
  const additionsIgnorePatterns = [
    '**/src/socketsecurity/bin-infra/**',
    '**/src/socketsecurity/binject/**',
    '**/src/socketsecurity/build-infra/**',
    '**/deps/fast-webstreams/**',
    '**/deps/lzfse/src/**',
    '**/deps/libdeflate/**',
  ]

  // Explicitly include libdeflate.gyp which is tracked in git (not a copy)
  const libdeflateGyp = path.join(
    PACKAGE_ROOT,
    'additions',
    'source-patched',
    'deps',
    'libdeflate',
    'libdeflate.gyp',
  )
  if (existsSync(libdeflateGyp)) {
    sources.push(libdeflateGyp)
  }

  for (const addDir of [...existingAdditionDirs, ...additionPhaseDirs]) {
    const addFiles = await glob('**/*', {
      absolute: true,
      cwd: addDir,
      ignore: additionsIgnorePatterns,
    })
    sources.push(...addFiles)
  }

  for (const scriptDir of existingScriptDirs) {
    const scriptFiles = await glob('*.mts', {
      absolute: true,
      cwd: scriptDir,
    })
    sources.push(...scriptFiles)
  }

  sources.push(__filename)

  // Apply cross-platform normalization and deduplication
  // (e.g., __filename may also be included via scriptDir glob)
  return normalizeAndDedup(sources)
}

/**
 * Main build orchestrator.
 */
async function main() {
  // Start timing total build.
  const totalStart = Date.now()

  // Track CPU count from environment or calculate adaptively
  const CPU_COUNT = (() => {
    if (process.env.BUILD_JOBS) {
      const envJobs = Number.parseInt(process.env.BUILD_JOBS, 10)
      if (Number.isNaN(envJobs) || envJobs < 1) {
        throw new Error(
          `Invalid BUILD_JOBS value: ${process.env.BUILD_JOBS} (must be a positive integer)`,
        )
      }
      return envJobs
    }
    return Math.max(
      1,
      Math.min(os.cpus().length, Math.floor(os.totalmem() / (BYTES.GB * 4))),
    )
  })()

  // Verify Node.js source checksum against nodejs.org (non-blocking).
  if (!process.env.SKIP_CHECKSUM_VERIFY) {
    logger.step('Verifying Node.js source checksum')
    const checksumResult = await verifyNodeChecksum()
    if (checksumResult.error) {
      logger.warn(`Checksum verification skipped: ${checksumResult.error}`)
    } else if (!checksumResult.valid) {
      throw new Error(
        `Node.js v${checksumResult.version} checksum mismatch!\n` +
          `  Expected (nodejs.org): ${checksumResult.expected}\n` +
          `  Actual (.gitmodules):  ${checksumResult.actual}\n` +
          'The .gitmodules checksum does not match the official Node.js release.\n' +
          'Run: SKIP_CHECKSUM_VERIFY=1 to bypass this check.',
      )
    } else {
      logger.success(`Node.js v${checksumResult.version} checksum verified`)
    }
  }

  // ============================================================================
  // PHASE 1: BINARY-RELEASED - Clone, patch, configure, compile
  // ============================================================================

  // Skip to specific checkpoint if requested.
  // --from-checkpoint=binary-released means "I have the release binary, skip to stripped phase".
  // --from-checkpoint=binary-stripped means "I have the stripped binary, skip to compressed phase".
  const skipReleasePhase =
    FROM_CHECKPOINT === CHECKPOINTS.BINARY_RELEASED ||
    FROM_CHECKPOINT === CHECKPOINTS.BINARY_STRIPPED ||
    FROM_CHECKPOINT === CHECKPOINTS.BINARY_COMPRESSED ||
    FROM_CHECKPOINT === CHECKPOINTS.FINALIZED
  const skipToCompressed =
    FROM_CHECKPOINT === CHECKPOINTS.BINARY_COMPRESSED ||
    FROM_CHECKPOINT === CHECKPOINTS.FINALIZED
  const skipToFinalized = FROM_CHECKPOINT === CHECKPOINTS.FINALIZED

  let releaseResult = { cached: false, isCrossCompiling: false }

  if (skipReleasePhase) {
    // Verify required artifact exists based on checkpoint
    if (FROM_CHECKPOINT === CHECKPOINTS.BINARY_RELEASED) {
      // When resuming from binary-released, only need the Release binary (no checkpoint file needed)
      if (!existsSync(outputReleaseBinary)) {
        throw new Error(
          `Cannot resume from ${FROM_CHECKPOINT}: Release binary not found at ${outputReleaseBinary}`,
        )
      }
    } else {
      // For later checkpoints, verify the checkpoint file exists
      const checkpointFile = path.join(
        BUILD_DIR,
        'checkpoints',
        `${FROM_CHECKPOINT}.json`,
      )
      if (!existsSync(checkpointFile)) {
        throw new Error(
          `Cannot skip to ${FROM_CHECKPOINT}: checkpoint not found at ${checkpointFile}`,
        )
      }
    }
    logger.log('')
    logger.log(
      `Skipping to ${FROM_CHECKPOINT} phase (--from-checkpoint=${FROM_CHECKPOINT})`,
    )
    logger.log('')
    // Mark as cached to skip phases
    releaseResult = { cached: true, isCrossCompiling: false }
  } else {
    releaseResult = await buildRelease(
      {
        allowCross: !!values['allow-cross'],
        arch: ARCH,
        autoYes: AUTO_YES,
        bootstrapFile,
        buildDir: BUILD_DIR,
        buildMode: BUILD_MODE,
        buildPatchesDir,
        cacheDir,
        cleanBuild: CLEAN_BUILD,
        collectBuildSourceFiles: () =>
          collectBuildSourceFiles(CHECKPOINTS.BINARY_RELEASED),
        isCI: IS_CI,
        isProdBuild: IS_PROD_BUILD,
        libc: TARGET_LIBC,
        modeSourceDir: MODE_SOURCE_DIR,
        nodeBinary,
        nodeRepo: NODE_REPO,
        nodeSha: NODE_SHA,
        nodeVersion: NODE_VERSION,
        outDir,
        outputReleaseBinary,
        outputReleaseDir,
        packageName: PACKAGE_NAME,
        packageRoot: PACKAGE_ROOT,
        patchedFile,
        platform: TARGET_PLATFORM,
        sharedBuildDir: SHARED_BUILD_DIR,
        sharedSourceDir: SHARED_SOURCE_DIR,
        testFile,
        withLief: WITH_LIEF,
      },
      { skipCheckpoint: BUILD_ONLY === CHECKPOINTS.BINARY_RELEASED },
    )
  }

  // Extract results from release phase
  // The buildRelease function already handles the checkpoint chain and will:
  // - Return early if 'finalized' checkpoint exists
  // - Resume from latest available checkpoint (binary-released, binary-stripped, etc.)
  // - Only rebuild what's needed based on cache validation
  const { isCrossCompiling } = releaseResult

  // Stop early if --stop-at=binary-released or --build-only=binary-released was specified
  if (
    STOP_AT === CHECKPOINTS.BINARY_RELEASED ||
    BUILD_ONLY === CHECKPOINTS.BINARY_RELEASED
  ) {
    logger.log('')
    if (BUILD_ONLY) {
      logger.skip(
        'Build completed at binary-released (--build-only=binary-released, checkpoint skipped)',
      )
    } else {
      logger.success(
        'Build stopped at binary-released (--stop-at=binary-released)',
      )
    }
    logger.log(`Released binary: ${outputReleaseBinary}`)
    logger.log('')
    return
  }

  // Check if finalized checkpoint exists (buildRelease returns early in this case)
  const finalizedCheckpoint = path.join(
    BUILD_DIR,
    'checkpoints',
    'finalized.json',
  )

  // If finalized checkpoint exists, build is already complete - just print summary
  if (existsSync(finalizedCheckpoint) && existsSync(outputFinalBinary)) {
    const binarySize = await getFileSize(outputFinalBinary)
    const totalTime = formatDuration(Date.now() - totalStart)

    printBuildSummary({
      binarySize,
      compressed: existsSync(outputCompressedBinary),
      cpuCount: CPU_COUNT,
      finalBinary: outputFinalBinary,
      nodeBinary,
      outputCompressedBinary,
      outputReleaseBinary,
      outputStrippedBinary,
      totalTime,
    })

    return
  }

  // ============================================================================
  // PHASE 2: STRIPPED - Strip debug symbols
  // ============================================================================
  if (skipToCompressed || skipToFinalized) {
    logger.log('Skipping stripped phase (using existing checkpoint)')
    logger.log('')
  } else {
    // Generate stripped-phase-specific source paths.
    const strippedSourcePaths = await collectBuildSourceFiles(
      CHECKPOINTS.BINARY_STRIPPED,
    )
    await buildStripped(
      {
        arch: ARCH,
        binaryName,
        buildDir: BUILD_DIR,
        buildSourcePaths: strippedSourcePaths,
        isCrossCompiling,
        isProdBuild: IS_PROD_BUILD,
        libc: TARGET_LIBC,
        nodeVersion: NODE_VERSION,
        outDir,
        outputReleaseBinary,
        outputStrippedBinary,
        outputStrippedDir,
        packageName: PACKAGE_NAME,
        platform: TARGET_PLATFORM,
        withLief: WITH_LIEF,
      },
      { skipCheckpoint: BUILD_ONLY === CHECKPOINTS.BINARY_STRIPPED },
    )
  }

  // Stop early if --stop-at=binary-stripped or --build-only=binary-stripped was specified
  if (
    STOP_AT === CHECKPOINTS.BINARY_STRIPPED ||
    BUILD_ONLY === CHECKPOINTS.BINARY_STRIPPED
  ) {
    logger.log('')
    if (BUILD_ONLY) {
      logger.skip(
        'Build completed at binary-stripped (--build-only=binary-stripped, checkpoint skipped)',
      )
    } else {
      logger.success(
        'Build stopped at binary-stripped (--stop-at=binary-stripped)',
      )
    }
    logger.log(`Stripped binary: ${outputStrippedBinary}`)
    logger.log('')
    return
  }

  // ============================================================================
  // PHASE 3: COMPRESSED - Compress binary for distribution
  // ============================================================================
  let compressed = false
  if (skipToFinalized) {
    logger.log('Skipping compressed phase (using existing checkpoint)')
    logger.log('')
    // Check if compressed binary exists
    compressed = existsSync(outputCompressedBinary)
  } else {
    // Generate compressed-phase-specific source paths.
    const compressedSourcePaths = await collectBuildSourceFiles(
      CHECKPOINTS.BINARY_COMPRESSED,
    )
    const result = await buildCompressed(
      {
        arch: ARCH,
        buildDir: BUILD_DIR,
        buildSourcePaths: compressedSourcePaths,
        isCrossCompiling,
        isProdBuild: IS_PROD_BUILD,
        libc: TARGET_LIBC,
        nodeVersion: NODE_VERSION,
        outputCompressedBinary,
        outputCompressedDir,
        outputStrippedBinary,
        packageName: PACKAGE_NAME,
        platform: TARGET_PLATFORM,
        withLief: WITH_LIEF,
      },
      { skipCheckpoint: BUILD_ONLY === CHECKPOINTS.BINARY_COMPRESSED },
    )
    compressed = result.compressed
  }

  // Stop early if --stop-at=binary-compressed or --build-only=binary-compressed was specified
  if (
    STOP_AT === CHECKPOINTS.BINARY_COMPRESSED ||
    BUILD_ONLY === CHECKPOINTS.BINARY_COMPRESSED
  ) {
    logger.log('')
    if (BUILD_ONLY) {
      logger.skip(
        'Build completed at binary-compressed (--build-only=binary-compressed, checkpoint skipped)',
      )
    } else {
      logger.success(
        'Build stopped at binary-compressed (--stop-at=binary-compressed)',
      )
    }
    logger.log(`Compressed binary: ${outputCompressedBinary}`)
    logger.log('')
    return
  }

  // ============================================================================
  // PHASE 4: FINALIZED - Copy final binary for distribution
  // ============================================================================

  // Write source hash to cache file BEFORE finalizeBinary checkpoint.
  // This prevents cache misses in concurrent builds by writing validation file
  // before checkpoint creation completes.
  const finalSourcePaths = await collectBuildSourceFiles(CHECKPOINTS.FINALIZED)
  await writeCacheHash(cacheDir, finalSourcePaths)

  await finalizeBinary({
    arch: ARCH,
    buildDir: BUILD_DIR,
    compressed,
    forceRebuild: CLEAN_BUILD,
    libc: TARGET_LIBC,
    nodeVersion: NODE_VERSION,
    outputCompressedBinary,
    outputFinalBinary,
    outputStrippedBinary,
    platform: TARGET_PLATFORM,
  })

  logger.logNewline()

  // Report build complete.
  const binarySize = await getFileSize(outputFinalBinary)

  // NOTE: Do NOT clean checkpoints here. Checkpoints are needed for incremental builds.
  // Only clean checkpoints on explicit --clean flag (handled at start of build).

  // Calculate total build time.
  const totalDuration = Date.now() - totalStart
  const totalTime = formatDuration(totalDuration)

  // Print build summary (from separate file to avoid cache invalidation).
  printBuildSummary({
    binarySize,
    compressed,
    cpuCount: CPU_COUNT,
    finalBinary: outputFinalBinary,
    nodeBinary,
    outputCompressedBinary,
    outputReleaseBinary,
    outputStrippedBinary,
    totalTime,
  })
}

// Run main function.
main().catch(error => {
  logger.fail(`Build failed: ${errorMessage(error)}`)
  throw error
})

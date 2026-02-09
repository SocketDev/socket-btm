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
 *   Starting size:                 ~49 MB (default Node.js v24 build)
 *
 *   Stage 1: Configure flags (applied)
 *     + --with-intl=small-icu:     ~44 MB  (-5 MB:  English-only ICU) ✓ USED
 *     + --without-* flags:         ~27 MB  (-22 MB: Remove npm, inspector, etc.) ✓ USED
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
 *   node scripts/load.mjs build-custom-node              # Normal build
 *   node scripts/load.mjs build-custom-node --clean      # Force fresh build
 *   node scripts/load.mjs build-custom-node --yes        # Auto-yes to prompts
 *   node scripts/load.mjs build-custom-node --verify     # Verify after build
 *   node scripts/load.mjs build-custom-node --test       # Build + run smoke tests
 *   node scripts/load.mjs build-custom-node --test-full  # Build + run full tests
 */

import { existsSync } from 'node:fs'
import { cpus, platform, totalmem } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  formatDuration,
  getFileSize,
  writeCacheHash,
} from 'build-infra/lib/build-helpers'
import { BYTES, CHECKPOINTS, NODE_VERSION } from 'build-infra/lib/constants'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { glob } from '@socketsecurity/lib/globs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  PACKAGE_ROOT,
  getBuildPaths,
  getSharedBuildPaths,
  getBuildSourcePaths,
  getExistingPaths,
} from './paths.mjs'
import { buildCompressed } from '../../binary-compressed/shared/build-compressed.mjs'
import { buildRelease } from '../../binary-released/shared/build-released.mjs'
import { buildStripped } from '../../binary-stripped/shared/build-stripped.mjs'
import { finalizeBinary } from '../../finalized/shared/finalize-binary.mjs'
import { printBuildSummary } from '../../lib/build-summary.mjs'

const __filename = fileURLToPath(import.meta.url)

// Hoist logger for consistent usage throughout the script.
const logger = getDefaultLogger()

// Parse arguments.
const { values } = parseArgs({
  options: {
    'allow-cross': { type: 'boolean', short: 'X' },
    arch: { type: 'string' },
    'build-only': { type: 'string' },
    clean: { type: 'boolean' },
    dev: { type: 'boolean' },
    'from-checkpoint': { type: 'string' },
    libc: { type: 'string' },
    'no-compress-sea': { type: 'boolean' },
    platform: { type: 'string' },
    prod: { type: 'boolean' },
    'stop-at': { type: 'string' },
    test: { type: 'boolean' },
    'test-full': { type: 'boolean' },
    verify: { type: 'boolean' },
    'with-lief': { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
  },
  strict: false,
})

const TARGET_PLATFORM = values.platform || platform()
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
const CLEAN_BUILD = !!values.clean
const AUTO_YES = !!values.yes
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
// NODE_SHA is derived from upstream/node at build time (see copy-source.mjs)
// Will be read from upstream/node
const NODE_SHA = undefined

const BUILD_MODE = IS_PROD_BUILD ? 'prod' : 'dev'
const WITH_LIEF = !!values['with-lief']

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
} = getBuildPaths(BUILD_MODE, TARGET_PLATFORM)
const BUILD_DIR = buildDir
const MODE_SOURCE_DIR = nodeSourceDir
const PACKAGE_NAME = ''

// Shared build directories (pristine source shared across dev/prod)
const { buildDir: SHARED_BUILD_DIR, nodeSourceDir: SHARED_SOURCE_DIR } =
  getSharedBuildPaths()

// Directory structure (fully isolated by build mode for concurrent builds).
// build/shared/ - Shared pristine artifacts (cloned source, extracted to dev/prod).
//   build/shared/source/ - Pristine Node.js source (archived in checkpoint).
//   build/shared/checkpoints/ - Source-cloned checkpoint (shared across dev/prod).
// build/dev/ - Dev build workspace (all artifacts isolated).
//   build/dev/source/ - Dev Node.js source code (extracted from shared checkpoint).
//   build/dev/out/ - Dev build outputs (Release, Stripped, Compressed, Final, etc.).
//   build/dev/.cache/ - Dev compiled binary cache + cache-validation.hash.
//   build/dev/checkpoints/ - Dev build checkpoints (source-patched, binary-released, etc.).
// build/prod/ - Prod build workspace (all artifacts isolated).
//   build/prod/source/ - Prod Node.js source code (extracted from shared checkpoint).
//   build/prod/out/ - Prod build outputs (Release, Stripped, Compressed, Final, etc.).
//   build/prod/.cache/ - Prod compiled binary cache + cache-validation.hash.
//   build/prod/checkpoints/ - Prod build checkpoints (source-patched, binary-released, etc.).

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
      cwd: patchDir,
      absolute: true,
    })
    sources.push(...patchFiles)
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

  // Recursively find all files in additions directories
  for (const addDir of [...existingAdditionDirs, ...additionPhaseDirs]) {
    const addFiles = await glob('**/*', {
      cwd: addDir,
      absolute: true,
    })
    sources.push(...addFiles)
  }

  for (const scriptDir of existingScriptDirs) {
    const scriptFiles = await glob('*.mjs', {
      cwd: scriptDir,
      absolute: true,
    })
    sources.push(...scriptFiles)
  }

  sources.push(__filename)

  return sources
}

/**
 * Main build orchestrator.
 */
async function main() {
  // Start timing total build.
  const totalStart = Date.now()

  // Track CPU count from environment or calculate adaptively
  const CPU_COUNT = process.env.BUILD_JOBS
    ? Number.parseInt(process.env.BUILD_JOBS, 10)
    : Math.max(
        1,
        Math.min(cpus().length, Math.floor(totalmem() / (BYTES.GB * 4))),
      )

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
        nodeVersion: NODE_VERSION,
        nodeSha: NODE_SHA,
        nodeRepo: NODE_REPO,
        buildDir: BUILD_DIR,
        packageName: PACKAGE_NAME,
        sharedBuildDir: SHARED_BUILD_DIR,
        sharedSourceDir: SHARED_SOURCE_DIR,
        modeSourceDir: MODE_SOURCE_DIR,
        buildPatchesDir,
        outDir,
        nodeBinary,
        outputReleaseDir,
        outputReleaseBinary,
        cacheDir,
        testFile,
        bootstrapFile,
        patchedFile,
        platform: TARGET_PLATFORM,
        arch: ARCH,
        libc: TARGET_LIBC,
        buildMode: BUILD_MODE,
        cleanBuild: CLEAN_BUILD,
        autoYes: AUTO_YES,
        isCI: IS_CI,
        isProdBuild: IS_PROD_BUILD,
        allowCross: !!values['allow-cross'],
        withLief: WITH_LIEF,
        collectBuildSourceFiles: () =>
          collectBuildSourceFiles(CHECKPOINTS.BINARY_RELEASED),
        packageRoot: PACKAGE_ROOT,
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
    const strippedSourcePaths = collectBuildSourceFiles(
      CHECKPOINTS.BINARY_STRIPPED,
    )
    await buildStripped(
      {
        buildDir: BUILD_DIR,
        packageName: PACKAGE_NAME,
        outputReleaseBinary,
        outputStrippedDir,
        outputStrippedBinary,
        outDir,
        platform: TARGET_PLATFORM,
        arch: ARCH,
        libc: TARGET_LIBC,
        binaryName,
        isCrossCompiling,
        buildSourcePaths: strippedSourcePaths,
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
    const compressedSourcePaths = collectBuildSourceFiles(
      CHECKPOINTS.BINARY_COMPRESSED,
    )
    const result = await buildCompressed(
      {
        buildDir: BUILD_DIR,
        packageName: PACKAGE_NAME,
        outputStrippedBinary,
        outputCompressedDir,
        outputCompressedBinary,
        platform: TARGET_PLATFORM,
        arch: ARCH,
        libc: TARGET_LIBC,
        isCrossCompiling,
        buildSourcePaths: compressedSourcePaths,
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
  await finalizeBinary({
    buildDir: BUILD_DIR,
    compressed,
    forceRebuild: CLEAN_BUILD,
    outputCompressedBinary,
    outputFinalBinary,
    outputStrippedBinary,
  })

  // Write source hash to cache file for future builds.
  // Uses centralized cache key helpers for consistent hash management.
  // Use 'finalized' phase for the main cache hash (includes all sources).
  const finalSourcePaths = await collectBuildSourceFiles(CHECKPOINTS.FINALIZED)
  await writeCacheHash(cacheDir, finalSourcePaths)
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
main().catch(e => {
  logger.fail(`Build failed: ${e.message}`)
  throw e
})

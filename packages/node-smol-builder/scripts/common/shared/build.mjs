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
 *     + --with-intl=none:          ~41 MB  (-8 MB:  No ICU, max size reduction)
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
 *   TARGET EXPECTED: ~21 MB (using small-icu, adds ~3MB vs intl=none)
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
import { cpus, platform, totalmem } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  exec,
  formatDuration,
  getFileSize,
  writeCacheHash,
} from 'build-infra/lib/build-helpers'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  NODE_VERSION_FILE,
  PACKAGE_ROOT,
  getBuildPaths,
  getSharedBuildPaths,
  getBuildSourcePaths,
  getExistingPaths,
} from './paths.mjs'
import { printBuildSummary } from '../../lib/build-summary.mjs'

const __filename = fileURLToPath(import.meta.url)

// Hoist logger for consistent usage throughout the script.
const logger = getDefaultLogger()

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
// Alias for shorter code
const ARCH = TARGET_ARCH
const CLEAN_BUILD = !!values.clean
const AUTO_YES = !!values.yes

// Build mode: dev (fast builds) vs prod (optimized builds).
// - CI: defaults to prod (unless --dev specified)
// - Local: defaults to dev (unless --prod specified)
const IS_CI = 'CI' in process.env
const IS_PROD_BUILD = values.prod || (!values.dev && IS_CI)

// Configuration

// Read Node.js version from .node-version file
const nodeVersionRaw = (await fs.readFile(NODE_VERSION_FILE, 'utf-8')).trim()
const NODE_VERSION = `v${nodeVersionRaw}`

// Read Node.js source metadata from package.json
const packageJson = JSON.parse(
  await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
)
const nodeSource = packageJson.sources?.node
if (!nodeSource) {
  throw new Error(
    'Missing sources.node in package.json. Please add source metadata.',
  )
}

const NODE_SHA = nodeSource.ref
const NODE_REPO = nodeSource.url

const BUILD_MODE = IS_PROD_BUILD ? 'prod' : 'dev'
const {
  binaryName,
  bootstrapFile,
  buildDir,
  buildPatchesDir,
  cacheDir,
  decompressorInCompressed,
  decompressorInFinal,
  decompressorName,
  nodeBinary,
  nodeSourceDir,
  outDir,
  outputCompressedBinary,
  outputCompressedDir,
  outputFinalBinary,
  outputFinalDir,
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
//   build/dev/checkpoints/ - Dev build checkpoints (source-patched, binary-release, etc.).
// build/prod/ - Prod build workspace (all artifacts isolated).
//   build/prod/source/ - Prod Node.js source code (extracted from shared checkpoint).
//   build/prod/out/ - Prod build outputs (Release, Stripped, Compressed, Final, etc.).
//   build/prod/.cache/ - Prod compiled binary cache + cache-validation.hash.
//   build/prod/checkpoints/ - Prod build checkpoints (source-patched, binary-release, etc.).

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
function collectBuildSourceFiles(phase = 'binary-released') {
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
    const patchFiles = readdirSync(patchDir)
      .filter(f => f.endsWith('.patch'))
      .map(f => path.join(patchDir, f))
    sources.push(...patchFiles)
  }

  for (const addDir of existingAdditionDirs) {
    const addFiles = readdirSync(addDir, { recursive: true })
      .filter(f => {
        const fullPath = path.join(addDir, f)
        try {
          return (
            existsSync(fullPath) &&
            !readdirSync(fullPath, { withFileTypes: true }).length
          )
        } catch {
          return true
        }
      })
      .map(f => path.join(addDir, f))
    sources.push(...addFiles)
  }

  for (const scriptDir of existingScriptDirs) {
    const scriptFiles = readdirSync(scriptDir)
      .filter(f => f.endsWith('.mjs'))
      .map(f => path.join(scriptDir, f))
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
  const CPU_COUNT = process.env.NODE_BUILD_JOBS
    ? Number.parseInt(process.env.NODE_BUILD_JOBS, 10)
    : Math.max(
        1,
        Math.min(
          cpus().length,
          Math.floor(totalmem() / (1024 * 1024 * 1024 * 4)),
        ),
      )

  // ============================================================================
  // PHASE 1: BINARY-RELEASED - Clone, patch, configure, compile
  // ============================================================================
  const { buildRelease } = await import(
    '../../binary-released/shared/build-release.mjs'
  )

  const releaseResult = await buildRelease({
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
    buildMode: BUILD_MODE,
    cleanBuild: CLEAN_BUILD,
    autoYes: AUTO_YES,
    isCI: IS_CI,
    isProdBuild: IS_PROD_BUILD,
    collectBuildSourceFiles: () => collectBuildSourceFiles('binary-released'),
    packageRoot: PACKAGE_ROOT,
  })

  const { cached: releaseCached, isCrossCompiling } = releaseResult

  // If release binary is cached AND final binary exists, skip entire build
  if (releaseCached && existsSync(outputFinalBinary)) {
    logger.log('')
    logger.success('Build complete - using cached artifacts')
    logger.log('Both release binary and final distribution are cached.')
    logger.log('')
    logger.substep(`Final binary: ${outputFinalBinary}`)
    logger.log('')

    const binarySize = await getFileSize(outputFinalBinary)
    const totalTime = formatDuration(Date.now() - totalStart)

    printBuildSummary({
      binarySize,
      buildDir: BUILD_DIR,
      compressed: existsSync(outputCompressedBinary),
      cpuCount: CPU_COUNT,
      decompressorName,
      finalBinary: outputFinalBinary,
      nodeBinary,
      outputCompressedBinary,
      outputReleaseBinary,
      outputStrippedBinary,
      totalTime,
    })

    return
  }

  // If release is cached but final binary missing, continue with post-processing phases
  if (releaseCached) {
    logger.log('')
    logger.log('Release binary cached, running post-processing phases...')
    logger.log('')
  }

  // ============================================================================
  // PHASE 2: STRIPPED - Strip debug symbols
  // ============================================================================
  const { buildStripped } = await import(
    '../../binary-stripped/shared/build-stripped.mjs'
  )
  // Generate stripped-phase-specific source paths
  const strippedSourcePaths = collectBuildSourceFiles('binary-stripped')
  await buildStripped({
    buildDir: BUILD_DIR,
    packageName: PACKAGE_NAME,
    outputReleaseBinary,
    outputStrippedDir,
    outputStrippedBinary,
    outDir,
    platform: TARGET_PLATFORM,
    arch: ARCH,
    binaryName,
    isCrossCompiling,
    buildSourcePaths: strippedSourcePaths,
  })

  // ============================================================================
  // PHASE 3: COMPRESSED - Compress binary for distribution
  // ============================================================================
  const { buildCompressed } = await import(
    '../../binary-compressed/shared/build-compressed.mjs'
  )
  // Generate compressed-phase-specific source paths
  const compressedSourcePaths = collectBuildSourceFiles('binary-compressed')
  const { compressed } = await buildCompressed({
    buildDir: BUILD_DIR,
    packageName: PACKAGE_NAME,
    outputStrippedBinary,
    outputCompressedDir,
    outputCompressedBinary,
    decompressorName,
    decompressorInCompressed,
    platform: TARGET_PLATFORM,
    arch: ARCH,
    shouldCompress: !values['no-compress-binary'],
    isCrossCompiling,
    buildSourcePaths: compressedSourcePaths,
  })

  // ============================================================================
  // PHASE 4: FINALIZED - Copy final binary for distribution
  // ============================================================================
  // Determine if we should use compressed binary for final distribution (default: yes for smol builds).
  const shouldUseCompression = compressed && existsSync(outputCompressedBinary)

  // Copy final distribution binary to build/out/Final.
  // Use compressed binary by default (smol!), or stripped if --no-compress.
  logger.step('Copying to Build Output (Final)')
  await safeMkdir(outputFinalDir)
  const finalBinary = outputFinalBinary

  if (shouldUseCompression) {
    logger.log('Copying compressed distribution package to Final directory...')
    logger.logNewline()

    // Copy compressed binary to Final.
    await fs.cp(outputCompressedBinary, finalBinary, {
      force: true,
      preserveTimestamps: true,
    })

    // Copy decompressor tool to Final.
    const decompressToolSource = decompressorInCompressed
    const decompressToolDest = decompressorInFinal

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
    logger.substep(`Location: ${outputFinalDir}`)
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
    logger.substep(`Location: ${outputFinalDir}`)
    logger.logNewline()
    logger.success('Final distribution created with uncompressed binary')
    logger.logNewline()
  }

  // Write source hash to cache file for future builds.
  // Uses centralized cache key helpers for consistent hash management.
  // Use 'finalized' phase for the main cache hash (includes all sources)
  const finalSourcePaths = collectBuildSourceFiles('finalized')
  await writeCacheHash(cacheDir, finalSourcePaths)
  logger.logNewline()

  // Report build complete.
  const binarySize = await getFileSize(finalBinary)

  // NOTE: Do NOT clean checkpoints here. Checkpoints are needed for incremental builds.
  // Only clean checkpoints on explicit --clean flag (handled at start of build).

  // Calculate total build time.
  const totalDuration = Date.now() - totalStart
  const totalTime = formatDuration(totalDuration)

  // Print build summary (from separate file to avoid cache invalidation).
  printBuildSummary({
    binarySize,
    buildDir: BUILD_DIR,
    compressed,
    cpuCount: CPU_COUNT,
    decompressorName,
    finalBinary,
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

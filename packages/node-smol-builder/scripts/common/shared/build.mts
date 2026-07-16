// max-file-lines: orchestrator -- single builder pipeline (fetch → patch → build → package) — splitting fractures the build sequence
/**
 * @file Build Node.js with SEA and dual compression support: clone/patch/
 *   configure/compile (binary-released) → strip (binary-stripped) → compress
 *   (binary-compressed) → copy to Final (finalized). CLI flags, the dual
 *   compression strategy, and the binary-size budget are documented at
 *   docs/agents.md/repo/node-smol-build-flags.md.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  formatDuration,
  getFileSize,
  writeCacheHash,
} from 'build-infra/lib/build-helpers'
import {
  computeBuildInputsFingerprint,
  formatStaleCheckpointMessage,
  isCheckpointFingerprintCurrent,
} from 'build-infra/lib/checkpoint-cache-key'
import { getCheckpointData } from 'build-infra/lib/checkpoint-manager'
import {
  CHECKPOINTS,
  NODE_VERSION,
  nodeVersionRaw,
} from 'build-infra/lib/constants'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'
import { verifyNodeChecksum } from 'build-infra/lib/version-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { collectBuildSourceFiles } from './collect-build-source-files.mts'
import { calculateCpuCount, parseBuildArgs } from './parse-build-args.mts'
import { getBuildPaths, getSharedBuildPaths, PACKAGE_ROOT } from './paths.mts'
import { buildCompressed } from '../../binary-compressed/shared/build-compressed.mts'
import { buildRelease } from '../../binary-released/shared/build-released.mts'
import { buildStripped } from '../../binary-stripped/shared/build-stripped.mts'
import { finalizeBinary } from '../../finalized/shared/finalize-binary.mts'
import { printBuildSummary } from '../../lib/build-summary.mts'

// Hoist logger for consistent usage throughout the script.
const logger = getDefaultLogger()

// Parse CLI arguments and derive build configuration.
const {
  ARCH,
  AUTO_YES,
  BUILD_MODE,
  BUILD_ONLY,
  CLEAN_BUILD,
  EXTRA_CONFIGURE_FLAGS,
  FROM_CHECKPOINT,
  IS_CI,
  IS_PROD_BUILD,
  NODE_REPO,
  NODE_SHA,
  STOP_AT,
  TARGET_ARCH,
  TARGET_LIBC,
  TARGET_PLATFORM,
  values,
  WITH_DAWN,
  WITH_LIEF,
} = parseBuildArgs()

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
} = getBuildPaths(
  BUILD_MODE,
  TARGET_PLATFORM,
  // socket-lint: allow top-level-await -- pure-ESM CLI entry point run
  // directly via node/tsx-style loaders; never bundled to CJS.
  values['platform-arch'] || (await getCurrentPlatformArch()),
)
const BUILD_DIR = buildDir
const MODE_SOURCE_DIR = nodeSourceDir
const PACKAGE_NAME = ''

// Shared build directories (pristine source shared across dev/prod)
const { buildDir: SHARED_BUILD_DIR, nodeSourceDir: SHARED_SOURCE_DIR } =
  getSharedBuildPaths()

// Directory structure (fully isolated by mode + platform-arch for concurrent
// builds) is documented at docs/agents.md/repo/node-smol-build-flags.md.

/**
 * Main build orchestrator.
 */
async function main() {
  // Start timing total build.
  const totalStart = Date.now()

  // Track CPU count from environment or calculate adaptively.
  const CPU_COUNT = calculateCpuCount()

  // Verify Node.js source checksum against nodejs.org. Fail-closed: a network
  // error from nodejs.org (DNS, 5xx, on-path attacker dropping the request)
  // is treated as a hard fail, otherwise an attacker on the path can downgrade
  // the only network-side cross-check of the .gitmodules SHA. The check is
  // fast — one HTTPS GET — so there's no perf justification for a bypass.
  logger.step('Verifying Node.js source checksum')
  const checksumResult = await verifyNodeChecksum()
  if (checksumResult.error) {
    throw new Error(
      `Node.js source checksum verification failed: ${checksumResult.error}\n` +
        'The build cannot proceed without verifying the .gitmodules SHA against ' +
        'the official Node.js release. Check network connectivity to nodejs.org.',
    )
  }
  if (!checksumResult.valid) {
    throw new Error(
      `Node.js v${checksumResult.version} checksum mismatch!\n` +
        `  Expected (nodejs.org): ${checksumResult.expected}\n` +
        `  Actual (.gitmodules):  ${checksumResult.actual}\n` +
        'The .gitmodules checksum does not match the official Node.js release.',
    )
  }
  logger.success(`Node.js v${checksumResult.version} checksum verified`)

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
          collectBuildSourceFiles(
            CHECKPOINTS.BINARY_RELEASED,
            TARGET_PLATFORM,
            TARGET_ARCH,
          ),
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
        withDawn: WITH_DAWN,
        withLief: WITH_LIEF,
        extraConfigureFlags: EXTRA_CONFIGURE_FLAGS,
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

  // If finalized checkpoint exists AND its build-inputs fingerprint still
  // matches additions/patches/node-version, the build is already complete
  // - just print summary. A stale or missing fingerprint must fall through
  // to a real build rather than shipping the old artifact.
  if (existsSync(finalizedCheckpoint) && existsSync(outputFinalBinary)) {
    const finalizedCheckpointData = await getCheckpointData(
      BUILD_DIR,
      PACKAGE_NAME,
      CHECKPOINTS.FINALIZED,
    )
    const currentFingerprint = computeBuildInputsFingerprint({
      dirs: [
        path.join(PACKAGE_ROOT, 'additions'),
        path.join(PACKAGE_ROOT, 'patches'),
      ],
      nodeVersion: nodeVersionRaw,
    })

    if (
      isCheckpointFingerprintCurrent({
        checkpointData: finalizedCheckpointData,
        currentFingerprint,
      })
    ) {
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

    logger.warn(
      formatStaleCheckpointMessage({
        checkpointFile: finalizedCheckpoint,
        checkpointName: CHECKPOINTS.FINALIZED,
        currentFingerprint,
        savedFingerprint: finalizedCheckpointData?.inputsFingerprint,
      }),
    )
    logger.log('')
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
      TARGET_PLATFORM,
      TARGET_ARCH,
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
        withDawn: WITH_DAWN,
        withLief: WITH_LIEF,
        extraConfigureFlags: EXTRA_CONFIGURE_FLAGS,
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
      TARGET_PLATFORM,
      TARGET_ARCH,
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
        withDawn: WITH_DAWN,
        withLief: WITH_LIEF,
        extraConfigureFlags: EXTRA_CONFIGURE_FLAGS,
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
  const finalSourcePaths = await collectBuildSourceFiles(
    CHECKPOINTS.FINALIZED,
    TARGET_PLATFORM,
    TARGET_ARCH,
  )
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

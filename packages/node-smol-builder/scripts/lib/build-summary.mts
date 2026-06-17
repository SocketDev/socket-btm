/**
 * @file Build Summary Output Displays build completion summary with statistics,
 *   binary locations, and next steps. This file is intentionally outside cache
 *   paths (scripts/common/, scripts/{phase}/) so changes to the summary don't
 *   invalidate build caches.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

/**
 * Print build completion summary.
 *
 * @param {object} options - Summary options.
 * @param {string} options.totalTime - Formatted total build time.
 * @param {string} options.binarySize - Formatted binary size.
 * @param {number} options.cpuCount - Number of CPU cores used.
 * @param {string} options.nodeBinary - Source binary path.
 * @param {string} options.outputReleaseBinary - Release binary path.
 * @param {string} options.outputStrippedBinary - Stripped binary path.
 * @param {string} options.outputCompressedBinary - Compressed binary path
 *   (optional)
 * @param {string} options.finalBinary - Final binary path.
 * @param {boolean} options.compressed - Whether binary is compressed.
 */
export function printBuildSummary({
  binarySize,
  compressed,
  cpuCount,
  finalBinary,
  nodeBinary,
  outputCompressedBinary,
  outputReleaseBinary,
  outputStrippedBinary,
  totalTime,
}) {
  logger.step('Build Complete!')

  // ASCII art success.
  logger.logNewline()
  logger.log('╔═══════════════════════════════════════╗')
  logger.log('║                                       ║')
  logger.log('║     ✨ Build Successful! ✨           ║')
  logger.log('║                                       ║')
  logger.log('╚═══════════════════════════════════════╝')
  logger.logNewline()

  logger.log('📊 Build Statistics:')
  logger.log(`   Total time: ${totalTime}`)
  logger.log(`   Binary size: ${binarySize}`)
  logger.log(`   CPU cores used: ${cpuCount}`)
  logger.logNewline()

  logger.log('📁 Binary Locations:')
  logger.log(`   Source:       ${nodeBinary}`)
  logger.log(`   Release:      ${outputReleaseBinary}`)
  logger.log(`   Stripped:     ${outputStrippedBinary}`)
  if (compressed) {
    logger.log(`   Compressed:   ${outputCompressedBinary} (self-extracting)`)
  }
  logger.log(`   Final:        ${finalBinary}`)
  logger.log(`   Distribution: ${finalBinary}`)
  logger.logNewline()

  logger.log('🚀 Next Steps:')
  if (compressed) {
    logger.log('   1. Test self-extracting binary:')
    logger.log(`      ${finalBinary} --version`)
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

  logger.log('📚 Documentation:')
  logger.log('   Patches: patches/README.md')
  logger.log('   Compression tools: binjected/README.md')
  logger.log('   Main README: README.md')
  logger.logNewline()
}

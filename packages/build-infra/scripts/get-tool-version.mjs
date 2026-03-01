/**
 * Get tool version from external-tools.json with hierarchical loading.
 *
 * Usage:
 *   node get-tool-version.mjs <tool-name> <version-key> [options]
 *
 * Examples:
 *   node get-tool-version.mjs ninja apt
 *   node get-tool-version.mjs python recommendedVersion
 *   node get-tool-version.mjs emscripten emsdk --package-root ../../onnxruntime-builder
 *   node get-tool-version.mjs gcc-13 apt --package-root ../../node-smol-builder --checkpoint binary-released
 *
 * Options:
 *   --package-root <path>     Package root directory (relative to this script)
 *   --checkpoint <name>       Checkpoint name for checkpoint-specific tools
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { getToolVersion } from '../lib/pinned-versions.mjs'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(args) {
  if (args.length < 2) {
    logger.fail(
      'Usage: get-tool-version.mjs <tool-name> <version-key> [options]',
    )
    logger.log('')
    logger.log('Examples:')
    logger.log('  get-tool-version.mjs ninja apt')
    logger.log('  get-tool-version.mjs python recommendedVersion')
    logger.log(
      '  get-tool-version.mjs emscripten emsdk --package-root ../../onnxruntime-builder',
    )
    logger.log(
      '  get-tool-version.mjs gcc-13 apt --package-root ../../node-smol-builder --checkpoint binary-released',
    )
    process.exitCode = 1
    return
  }

  const toolName = args[0]
  const versionKey = args[1]

  let packageRoot
  let checkpointName

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--package-root' && i + 1 < args.length) {
      // Resolve relative to current working directory, not script location
      packageRoot = path.resolve(process.cwd(), args[i + 1])
      i++
    } else if (args[i] === '--checkpoint' && i + 1 < args.length) {
      checkpointName = args[i + 1]
      i++
    }
  }

  return { checkpointName, packageRoot, toolName, versionKey }
}

function main() {
  const { checkpointName, packageRoot, toolName, versionKey } = parseArgs(
    process.argv.slice(2),
  )

  const options = {}
  if (packageRoot) {
    options.packageRoot = packageRoot
  }
  if (checkpointName) {
    options.checkpointName = checkpointName
  }

  const version = getToolVersion(toolName, versionKey, options)

  if (!version) {
    logger.fail(
      `No version found for tool '${toolName}' with version key '${versionKey}'`,
    )
    if (packageRoot || checkpointName) {
      logger.fail(
        `Context: packageRoot=${packageRoot || 'none'}, checkpoint=${checkpointName || 'none'}`,
      )
    }
    process.exitCode = 1
    return
  }

  // Output just the version for easy capture in scripts.
  logger.log(version)
}

main()

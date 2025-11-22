#!/usr/bin/env node
/**
 * Get tool version from external-tools.json with hierarchical loading.
 *
 * Usage:
 *   node get-tool-version.mjs <tool-name> <package-manager> [options]
 *
 * Examples:
 *   node get-tool-version.mjs ninja apt
 *   node get-tool-version.mjs emscripten emsdk --package-root ../../onnxruntime-builder
 *   node get-tool-version.mjs gcc-13 apt --package-root ../../node-smol-builder --checkpoint binary-released
 *
 * Options:
 *   --package-root <path>     Package root directory (relative to this script)
 *   --checkpoint <name>       Checkpoint name for checkpoint-specific tools
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getToolVersion } from '../lib/pinned-versions.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(args) {
  const toolName = args[0]
  const packageManager = args[1]

  if (!toolName || !packageManager) {
    console.error(
      'Usage: get-tool-version.mjs <tool-name> <package-manager> [options]',
    )
    console.error('')
    console.error('Examples:')
    console.error('  get-tool-version.mjs ninja apt')
    console.error(
      '  get-tool-version.mjs emscripten emsdk --package-root ../../onnxruntime-builder',
    )
    console.error(
      '  get-tool-version.mjs gcc-13 apt --package-root ../../node-smol-builder --checkpoint binary-released',
    )
    process.exit(1)
  }

  let packageRoot
  let checkpointName

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--package-root' && args[i + 1]) {
      // Resolve relative to current working directory, not script location
      packageRoot = path.resolve(process.cwd(), args[i + 1])
      i++
    } else if (args[i] === '--checkpoint' && args[i + 1]) {
      checkpointName = args[i + 1]
      i++
    }
  }

  return { checkpointName, packageManager, packageRoot, toolName }
}

function main() {
  const { checkpointName, packageManager, packageRoot, toolName } = parseArgs(
    process.argv.slice(2),
  )

  const options = {}
  if (packageRoot) {
    options.packageRoot = packageRoot
  }
  if (checkpointName) {
    options.checkpointName = checkpointName
  }

  const version = getToolVersion(toolName, packageManager, options)

  if (!version) {
    console.error(
      `Error: No version found for tool '${toolName}' with package manager '${packageManager}'`,
    )
    if (packageRoot || checkpointName) {
      console.error(
        `Context: packageRoot=${packageRoot || 'none'}, checkpoint=${checkpointName || 'none'}`,
      )
    }
    process.exit(1)
  }

  // Output just the version for easy capture in scripts
  console.log(version)
}

main()

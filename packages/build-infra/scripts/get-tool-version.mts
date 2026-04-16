/**
 * Get tool version from external-tools.json.
 *
 * Zero external dependencies — safe to run before pnpm install.
 *
 * Usage:
 *   node get-tool-version.mts <tool-name> [version-key]
 *
 * Examples:
 *   node get-tool-version.mts python version    # prints "3.11"
 *   node get-tool-version.mts ninja version     # prints "1.12.1"
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Parse --package-root flag to find the right external-tools.json.
const args = process.argv.slice(2)
let packageRoot = path.join(__dirname, '..')
const packageRootIdx = args.indexOf('--package-root')
if (packageRootIdx !== -1 && args[packageRootIdx + 1]) {
  packageRoot = path.resolve(args[packageRootIdx + 1])
  args.splice(packageRootIdx, 2)
}

const EXTERNAL_TOOLS_PATH = path.join(packageRoot, 'external-tools.json')
const toolName = args[0]
const versionKey = args[1] || 'version'

if (!toolName) {
  console.error(
    'Usage: get-tool-version.mts <tool-name> [version-key] [--package-root <path>]',
  )
  process.exitCode = 1
} else {
  try {
    const data = JSON.parse(readFileSync(EXTERNAL_TOOLS_PATH, 'utf8'))
    const tool = data.tools?.[toolName]
    if (!tool) {
      console.error(`Tool '${toolName}' not found in external-tools.json`)
      console.error(`Available: ${Object.keys(data.tools || {}).join(', ')}`)
      process.exitCode = 1
    } else {
      const value = tool[versionKey] ?? tool.version
      if (!value) {
        console.error(`No '${versionKey}' found for tool '${toolName}'`)
        process.exitCode = 1
      } else {
        console.log(value)
      }
    }
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

/**
 * Get tool version from external-tools.json.
 *
 * Zero external dependencies — safe to run before pnpm install.
 *
 * Usage:
 *   node get-tool-version.mjs <tool-name> [version-key]
 *
 * Examples:
 *   node get-tool-version.mjs python version    # prints "3.11"
 *   node get-tool-version.mjs ninja version     # prints "1.12.1"
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTERNAL_TOOLS_PATH = path.join(__dirname, '..', 'external-tools.json')

const toolName = process.argv[2]
if (!toolName) {
  console.error('Usage: get-tool-version.mjs <tool-name> [version-key]')
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
      const key = process.argv[3] || 'version'
      const value = tool[key] ?? tool.version
      if (!value) {
        console.error(`No '${key}' found for tool '${toolName}'`)
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

#!/usr/bin/env node
/**
 * @fileoverview Developer setup script for socket-btm monorepo.
 *
 * Checks and prepares build environment:
 * - Node.js version (>=18.0.0)
 * - pnpm version (>=10.21.0)
 * - Build toolchain (cmake, ninja, python, rust, etc.)
 *
 * Usage:
 *   pnpm run setup                # Check prerequisites
 *   pnpm run setup --install      # Check and auto-install missing tools
 *   pnpm run setup --quiet        # Minimal output
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawnSync } from '@socketsecurity/lib/spawn'
import { printFooter } from '@socketsecurity/lib/stdio/footer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MONOREPO_ROOT = path.join(__dirname, '..')
const BUILD_INFRA_EXTERNAL_TOOLS = path.join(
  MONOREPO_ROOT,
  'packages',
  'build-infra',
  'external-tools.json',
)

const logger = getDefaultLogger()
const argv: string[] = process.argv
const quiet = argv.includes('--quiet')

const log = {
  error: (msg: string): void => {
    logger.error(msg)
  },
  info: (msg: string): void => {
    if (!quiet) {
      logger.info(msg)
    }
  },
  step: (msg: string): void => {
    if (!quiet) {
      logger.substep(msg)
    }
  },
  success: (msg: string): void => {
    if (!quiet) {
      logger.success(msg)
    }
  },
  warn: (msg: string): void => {
    logger.warn(msg)
  },
}

type ToolCheck = {
  command: string
  name: string
}

// Compare two dotted-numeric versions. Returns true if `have` is greater
// than or equal to `need`. Non-numeric segments (prerelease tags, build
// metadata) are ignored — setup-script scope is simple gte of release
// versions. For full semver semantics, downstream code uses
// node:smol-versions; this script runs before any workspace install and
// must stay zero-dependency.
function versionGte(have: string, need: string): boolean {
  const parts = (v: string): number[] =>
    v
      .split(/[.+-]/, 3)
      .map(p => Number.parseInt(p, 10))
      .map(n => (Number.isNaN(n) ? 0 : n))
  const a = parts(have)
  const b = parts(need)
  for (let i = 0; i < 3; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai > bi) {
      return true
    }
    if (ai < bi) {
      return false
    }
  }
  return true
}

async function checkNodeVersion(): Promise<boolean> {
  const required = '18.0.0'
  // Remove 'v' prefix
  const current = process.version.slice(1)
  if (!versionGte(current, required)) {
    log.error(`Node.js ${current} is below required ${required}`)
    log.info('Install from: https://nodejs.org/')
    return false
  }
  log.success(`Node.js ${current} (required: >=${required})`)
  return true
}

async function checkPnpmVersion(): Promise<boolean> {
  const required = '10.21.0'
  try {
    const result = spawnSync('pnpm', ['--version'])
    if (result.status !== 0) {
      throw new Error('pnpm command failed')
    }
    const version = String(result.stdout).trim()
    if (!versionGte(version, required)) {
      log.error(`pnpm ${version} is below required ${required}`)
      log.info('Install from: https://pnpm.io/installation')
      return false
    }
    log.success(`pnpm ${version} (required: >=${required})`)
    return true
  } catch {
    log.error(`pnpm not found (required: >=${required})`)
    log.info('Install from: https://pnpm.io/installation')
    return false
  }
}

async function checkBuildToolchain(): Promise<boolean> {
  // Required tools for `pnpm run check` and basic builds. Names map to
  // entries in packages/build-infra/external-tools.json — the JSON is
  // the source of truth for versions and install docs; this list just
  // says which tools to probe at setup time. Commands vary because
  // tool-names don't always match their CLI probe name (e.g. ripgrep
  // → `rg`, python → `python3`).
  const tools: Array<ToolCheck & { externalToolsKey: string }> = [
    { command: 'cmake --version', name: 'cmake', externalToolsKey: 'cmake' },
    { command: 'ninja --version', name: 'ninja', externalToolsKey: 'ninja' },
    {
      command: 'python3 --version',
      name: 'python3',
      externalToolsKey: 'python',
    },
    { command: 'cargo --version', name: 'cargo', externalToolsKey: 'cargo' },
    { command: 'rg --version', name: 'ripgrep', externalToolsKey: 'ripgrep' },
  ]

  // Validate every probed tool is declared in external-tools.json so
  // the JSON stays the single source of truth. Missing entries here
  // usually mean a tool got added to setup.mts but not to the JSON.
  let externalTools: Record<string, unknown> = {}
  try {
    const raw = readFileSync(BUILD_INFRA_EXTERNAL_TOOLS, 'utf8')
    const parsed = JSON.parse(raw) as { tools?: Record<string, unknown> }
    externalTools = parsed.tools ?? {}
  } catch (e) {
    log.warn(
      `Could not read ${BUILD_INFRA_EXTERNAL_TOOLS}: ${String((e as Error).message)}`,
    )
  }
  const undeclared = tools
    .filter(t => !(t.externalToolsKey in externalTools))
    .map(t => t.externalToolsKey)
  if (undeclared.length > 0) {
    log.warn(
      `Tools probed by setup.mts are missing from build-infra/external-tools.json: ${undeclared.join(', ')}`,
    )
  }

  const missing: string[] = []
  const found: string[] = []

  for (const tool of tools) {
    try {
      // Split command into program and arguments
      const [cmd, ...args] = tool.command.split(' ')
      if (!cmd) {
        missing.push(tool.name)
        continue
      }
      const result = spawnSync(cmd, args, {
        stdio: 'ignore',
      })
      if (result.status === 0) {
        found.push(tool.name)
      } else {
        missing.push(tool.name)
      }
    } catch {
      missing.push(tool.name)
    }
  }

  if (found.length > 0) {
    log.success(`Build tools found: ${found.join(', ')}`)
  }

  if (missing.length > 0) {
    log.warn(`Build tools missing: ${missing.join(', ')}`)
    log.info(
      'Run to install: node packages/node-smol-builder/scripts/setup-build-toolchain.mts',
    )
    return false
  }

  return true
}

async function setup(): Promise<void> {
  if (!quiet) {
    logger.step('socket-btm Setup')
  }

  let allGood = true

  // Check prerequisites
  log.step('Checking prerequisites...')
  allGood = (await checkNodeVersion()) && allGood
  allGood = (await checkPnpmVersion()) && allGood

  // Check build toolchain
  log.step('Checking build toolchain...')
  const toolchainOk = await checkBuildToolchain()
  allGood = toolchainOk && allGood

  if (!toolchainOk && !quiet) {
    log.info('')
  }

  // Install dependencies
  if (!quiet) {
    log.step('Installing dependencies...')
    log.info('Run: pnpm install')
  }

  if (!quiet) {
    const label = allGood ? 'Setup complete' : 'Setup completed with warnings'
    printFooter(label)
  }

  process.exitCode = allGood ? 0 : 1
}

setup().catch((e: unknown) => {
  logger.error('Setup failed')
  logger.error(e)
  process.exitCode = 1
})

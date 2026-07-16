/**
 * Python Package Installation Utilities.
 *
 * Provides utilities for automatically installing Python packages using pip.
 * Supports virtual environments for PEP 668 compliant systems (Homebrew Python,
 * etc).
 */

import { existsSync, promises as fs, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from './error-utils.mts'

const logger = getDefaultLogger()

// PEP 668 marker filename shipped by Debian/Ubuntu to opt the system
// interpreter out of unmanaged pip installs. Living next to any
// stdlib dir means `pip install` into that interpreter will refuse
// without `--break-system-packages`.
const PEP_668_MARKER = 'EXTERNALLY-MANAGED'
let cachedPEP668

/**
 * Detect whether the system Python interpreter is PEP 668 managed.
 *
 * Debian/Ubuntu (python3 ≥ 3.11) place an EXTERNALLY-MANAGED marker
 * under each stdlib dir (e.g. /usr/lib/python3.12/EXTERNALLY-MANAGED).
 * When present, `pip install` refuses system-wide or --user installs
 * without `--break-system-packages`. A venv has its own sysconfig and
 * no such marker, so this only matters when we are falling back to
 * system pip.
 *
 * @returns {boolean} True if a PEP 668 marker is present.
 */
export function isPEP668Managed() {
  if (cachedPEP668 !== undefined) {
    return cachedPEP668
  }
  // Only meaningful on Linux-ish systems — macOS/Windows ship pip
  // without the marker.
  if (process.platform !== 'linux') {
    cachedPEP668 = false
    return cachedPEP668
  }
  // Check every /usr/lib/python3.* stdlib dir; Ubuntu 24.04 ships
  // only one, but 22.04 shipped both 3.10 and 3.11 side by side.
  const libDir = '/usr/lib'
  try {
    const entries = readdirSync(libDir)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry.startsWith('python3')) {
        continue
      }
      if (existsSync(path.join(libDir, entry, PEP_668_MARKER))) {
        cachedPEP668 = true
        return cachedPEP668
      }
    }
  } catch {
    // /usr/lib unreadable — assume not managed.
  }
  cachedPEP668 = false
  return cachedPEP668
}

export function setCachedPEP668(val: boolean) {
  cachedPEP668 = val
}

// Global venv state
let venvPath
let venvPipPath
let venvPythonPath
export let venvInitialized = false
export let venvAvailable = false

/**
 * Check if pip is available.
 *
 * @returns {boolean} True if pip is available.
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by pip-install pipeline phase (detect → resolve → install → verify); alphabetizing across phases would scatter the install flow.
export function checkPipAvailable() {
  return Boolean(
    whichSync('pip3', { nothrow: true }) || whichSync('pip', { nothrow: true }),
  )
}

/**
 * Get pip command (pip3 or pip).
 *
 * @returns {string | undefined} Resolved pip command path or undefined if not
 *   found.
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by pip-install pipeline phase (detect → resolve → install → verify); alphabetizing across phases would scatter the install flow.
export function getPipCommand() {
  // If venv is available, use it
  if (venvAvailable && venvPipPath) {
    return venvPipPath
  }
  // Lazy detection — see getPythonCommand() for rationale.
  if (!venvInitialized) {
    const probeVenvPath = venvPath || getDefaultVenvPath()
    const probePython = path.join(probeVenvPath, 'bin', 'python3')
    const probePip = path.join(probeVenvPath, 'bin', 'pip3')
    if (existsSync(probePython) && existsSync(probePip)) {
      venvPath = probeVenvPath
      venvPythonPath = probePython
      venvPipPath = probePip
      venvAvailable = true
      venvInitialized = true
      return probePip
    }
  }
  const pip3Path = whichSync('pip3', { nothrow: true })
  if (pip3Path) {
    return pip3Path
  }
  const pipPath = whichSync('pip', { nothrow: true })
  if (pipPath) {
    return pipPath
  }
  return undefined
}

/**
 * Get the default venv path for Socket CLI builds.
 *
 * @returns {string} Path to the shared venv directory.
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by pip-install pipeline phase (detect → resolve → install → verify); alphabetizing across phases would scatter the install flow.
export function getDefaultVenvPath() {
  return path.join(os.homedir(), '.socket-btm-venv')
}

/**
 * Initialize a virtual environment for Python package installation.
 * This is required for PEP 668 compliant systems (Homebrew Python, etc).
 *
 * @param {object} options - Options.
 * @param {string} options.venvDir - Optional custom venv directory.
 * @param {boolean} options.quiet - Suppress output.
 *
 * @returns {Promise<boolean>} True if venv is ready.
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by pip-install pipeline phase (detect → resolve → install → verify); alphabetizing across phases would scatter the install flow.
export async function initializeVenv({ quiet = false, venvDir } = {}) {
  // Only initialize once per process
  if (venvInitialized) {
    return venvAvailable
  }
  venvInitialized = true

  const targetVenvPath = venvDir || getDefaultVenvPath()
  venvPath = targetVenvPath

  // Check if venv already exists and is valid
  const venvBinDir = path.join(targetVenvPath, 'bin')
  const potentialPip = path.join(venvBinDir, 'pip3')
  const potentialPython = path.join(venvBinDir, 'python3')

  if (existsSync(potentialPip) && existsSync(potentialPython)) {
    venvPipPath = potentialPip
    venvPythonPath = potentialPython
    venvAvailable = true
    if (!quiet) {
      logger.substep(`Using existing venv: ${targetVenvPath}`)
    }
    return true
  }

  // Find system Python to create venv
  const systemPython =
    whichSync('python3', { nothrow: true }) ||
    whichSync('python', { nothrow: true })
  if (!systemPython) {
    if (!quiet) {
      logger.warn('Python not found - cannot create venv')
    }
    return false
  }

  // Create venv
  try {
    await fs.mkdir(path.dirname(targetVenvPath), { recursive: true })
    if (!quiet) {
      logger.substep(`Creating Python venv: ${targetVenvPath}`)
    }

    const createResult = await spawn(
      systemPython,
      ['-m', 'venv', targetVenvPath],
      {
        stdio: quiet ? 'pipe' : 'inherit',
      },
    )

    if (createResult.code !== 0) {
      if (!quiet) {
        logger.warn('Failed to create venv')
      }
      return false
    }

    // Verify venv was created
    if (existsSync(potentialPip) && existsSync(potentialPython)) {
      venvPipPath = potentialPip
      venvPythonPath = potentialPython
      venvAvailable = true

      // Upgrade pip in the venv to avoid warnings
      if (!quiet) {
        logger.substep('Upgrading pip in venv…')
      }
      await spawn(venvPipPath, ['install', '--upgrade', 'pip'], {
        stdio: quiet ? 'pipe' : 'inherit',
      })

      if (!quiet) {
        logger.success('Python venv ready')
      }
      return true
    }

    if (!quiet) {
      logger.warn('Venv creation did not produce expected binaries')
    }
    return false
  } catch (e) {
    if (!quiet) {
      logger.warn(`Failed to create venv: ${errorMessage(e)}`)
    }
    return false
  }
}

// Cache for Python command derived from pip
let cachedPythonCommand

/**
 * Get Python command that corresponds to pip.
 *
 * This ensures we use the same Python that pip installs packages for.
 * On macOS, pip3 and python3 may point to different Python installations.
 *
 * If a venv is available, uses the venv's Python.
 * Otherwise derives Python path from `pip --version` output which shows the pip
 * installation path. From this path, we can find the corresponding Python.
 *
 * @returns {Promise<string | undefined>} Resolved python command path or
 *   undefined if not found.
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by pip-install pipeline phase (detect → resolve → install → verify); alphabetizing across phases would scatter the install flow.
export async function getPythonCommand() {
  // If venv is available, use it
  if (venvAvailable && venvPythonPath) {
    return venvPythonPath
  }
  // Lazy detection: if a venv already exists on disk from a previous
  // run but initializeVenv() hasn't been called yet in this process,
  // pick it up rather than falling back to system python (which is
  // likely to be PEP 668 locked and missing packages we installed in
  // the venv earlier).
  if (!venvInitialized) {
    const probeVenvPath = venvPath || getDefaultVenvPath()
    const probePython = path.join(probeVenvPath, 'bin', 'python3')
    const probePip = path.join(probeVenvPath, 'bin', 'pip3')
    if (existsSync(probePython) && existsSync(probePip)) {
      venvPath = probeVenvPath
      venvPythonPath = probePython
      venvPipPath = probePip
      venvAvailable = true
      venvInitialized = true
      return probePython
    }
  }

  if (cachedPythonCommand !== undefined) {
    return cachedPythonCommand || undefined
  }

  const pip = getPipCommand()
  if (!pip) {
    cachedPythonCommand = ''
    return undefined
  }

  // Run pip --version to get pip's installation path
  // Format: pip X.X.X from /path/to/lib/pythonX.X/site-packages/pip (python X.X)
  try {
    const { stdout: pipVersion } = await spawn(pip, ['--version'], {
      stdio: 'pipe',
    })

    // Parse the path from output: "pip X.X.X from /path/to/site-packages/pip (python X.X)"
    const pathMatch = pipVersion.trim().match(/from\s+(.+?)(?:$|\s+\()/)
    if (pathMatch) {
      const pipPath = pathMatch[1].trim()
      // pipPath is like: /path/to/lib/pythonX.X/site-packages/pip
      // We need: /path/to/bin/pythonX.X

      // Walk up from site-packages to find bin directory
      // Pattern: .../lib/pythonX.X/site-packages/pip -> .../bin/pythonX
      // site-packages
      let current = path.dirname(pipPath)
      // pythonX.X
      current = path.dirname(current)
      // e.g., "python3.9"
      const pythonVersion = path.basename(current)
      // lib
      current = path.dirname(current)
      const libDir = path.basename(current)

      if (libDir === 'lib') {
        // parent of lib
        current = path.dirname(current)
        const binDir = path.join(current, 'bin')

        // Try python3 first, then pythonX.X
        const candidates = ['python3', pythonVersion, 'python']
        for (let i = 0, { length } = candidates; i < length; i += 1) {
          const candidate = candidates[i]
          const pythonPath = path.join(binDir, candidate)
          if (existsSync(pythonPath)) {
            cachedPythonCommand = pythonPath
            return cachedPythonCommand
          }
        }
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: use whichSync
  const python3Path = whichSync('python3', { nothrow: true })
  if (python3Path) {
    cachedPythonCommand = python3Path
    return cachedPythonCommand
  }
  const pythonPath = whichSync('python', { nothrow: true })
  cachedPythonCommand = pythonPath || ''
  return cachedPythonCommand || undefined
}

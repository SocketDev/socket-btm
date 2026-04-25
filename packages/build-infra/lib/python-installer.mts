/**
 * Python Package Installation Utilities
 *
 * Provides utilities for automatically installing Python packages using pip.
 * Supports virtual environments for PEP 668 compliant systems (Homebrew Python, etc).
 */

import { existsSync, promises as fs, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { printError } from './build-output.mts'
import { errorMessage } from './error-utils.mts'
import {
  PYTHON_VERSIONS,
  getPinnedPackage,
  loadPythonVersions,
} from './pinned-versions.mts'

const logger = getDefaultLogger()

// PEP 668 marker filename shipped by Debian/Ubuntu to opt the system
// interpreter out of unmanaged pip installs. Living next to any
// stdlib dir means `pip install` into that interpreter will refuse
// without `--break-system-packages`.
const PEP_668_MARKER = 'EXTERNALLY-MANAGED'
// Substring pip prints when PEP 668 rejects an install; used as a
// runtime fallback for cases where the marker can't be found on disk.
const PEP_668_ERROR_TOKEN = 'externally-managed-environment'

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
function isPEP668Managed() {
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

// Global venv state
let _venvPath
let venvPipPath
let venvPythonPath
let venvInitialized = false
let venvAvailable = false

/**
 * Check if pip is available.
 *
 * @returns {boolean} True if pip is available.
 */
export function checkPipAvailable() {
  return Boolean(
    whichSync('pip3', { nothrow: true }) || whichSync('pip', { nothrow: true }),
  )
}

/**
 * Get pip command (pip3 or pip).
 *
 * @returns {string|undefined} Resolved pip command path or undefined if not found.
 */
export function getPipCommand() {
  // If venv is available, use it
  if (venvAvailable && venvPipPath) {
    return venvPipPath
  }
  // Lazy detection — see getPythonCommand() for rationale.
  if (!venvInitialized) {
    const probeVenvPath = _venvPath || getDefaultVenvPath()
    const probePython = path.join(probeVenvPath, 'bin', 'python3')
    const probePip = path.join(probeVenvPath, 'bin', 'pip3')
    if (existsSync(probePython) && existsSync(probePip)) {
      _venvPath = probeVenvPath
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
 * @returns {Promise<boolean>} True if venv is ready.
 */
export async function initializeVenv({ quiet = false, venvDir } = {}) {
  // Only initialize once per process
  if (venvInitialized) {
    return venvAvailable
  }
  venvInitialized = true

  const targetVenvPath = venvDir || getDefaultVenvPath()
  _venvPath = targetVenvPath

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
        logger.substep('Upgrading pip in venv...')
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
 * @returns {Promise<string|undefined>} Resolved python command path or undefined if not found.
 */
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
    const probeVenvPath = _venvPath || getDefaultVenvPath()
    const probePython = path.join(probeVenvPath, 'bin', 'python3')
    const probePip = path.join(probeVenvPath, 'bin', 'pip3')
    if (existsSync(probePython) && existsSync(probePip)) {
      _venvPath = probeVenvPath
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
    const pathMatch = pipVersion.trim().match(/from\s+(.+?)(?:\s+\(|$)/)
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
        for (const candidate of candidates) {
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

/**
 * Check if a Python package is installed.
 *
 * @param {string} packageName - Package name to check.
 * @returns {Promise<boolean>} True if package is installed.
 */
export async function checkPythonPackage(packageName) {
  try {
    const pythonCmd = await getPythonCommand()
    if (!pythonCmd) {
      return false
    }
    const result = await spawn(pythonCmd, ['-c', `import ${packageName}`], {})
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if a Python package is installed with the correct pinned version.
 *
 * @param {string} packageName - Package name to check.
 * @param {string} expectedVersion - Expected version (e.g., '2.5.1').
 * @returns {Promise<boolean>} True if package is installed with correct version.
 */
export async function checkPythonPackageVersion(packageName, expectedVersion) {
  try {
    const pythonCmd = await getPythonCommand()
    if (!pythonCmd) {
      return false
    }
    const result = await spawn(
      pythonCmd,
      ['-c', `import ${packageName}; print(${packageName}.__version__)`],
      { stdio: 'pipe' },
    )
    if (result.code !== 0) {
      return false
    }
    const installedVersion = (result.stdout || '').trim()
    return installedVersion === expectedVersion
  } catch {
    return false
  }
}

/**
 * Install a Python package using pip.
 *
 * Uses venv if available (for PEP 668 compliant systems like Homebrew Python).
 * Falls back to --user mode if venv is not available.
 *
 * @param {string} packageName - Package name to install.
 * @param {object} options - Installation options.
 * @param {boolean} options.user - Install to user site-packages if no venv (--user flag).
 * @param {boolean} options.upgrade - Upgrade if already installed (--upgrade flag).
 * @param {boolean} options.quiet - Suppress output.
 * @param {string} options.consumerPackageJsonPath - Optional path to consumer package.json for version overrides.
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installPythonPackage(
  packageName,
  { consumerPackageJsonPath, quiet = false, upgrade = false, user = true } = {},
) {
  // Initialize venv if not already done (handles PEP 668)
  if (!venvInitialized) {
    await initializeVenv({ quiet })
  }

  const pip = getPipCommand()
  if (!pip) {
    if (!quiet) {
      printError('pip not found. Please install Python 3 with pip.')
    }
    return false
  }

  // Use pinned version for reproducible builds
  // Load Python versions with consumer overrides if provided
  let pinnedPackage
  if (consumerPackageJsonPath) {
    // Convert package.json path to packageRoot for loadPythonVersions
    const packageRoot = path.dirname(consumerPackageJsonPath)
    const {
      PYTHON_PACKAGE_EXTRAS: consumerExtras,
      PYTHON_VERSIONS: consumerVersions,
    } = loadPythonVersions({ packageRoot })
    const version = consumerVersions[packageName]
    if (!version) {
      throw new Error(
        `No pinned version found for ${packageName}. Add to external-tools.json with type: "python"`,
      )
    }
    const extras = consumerExtras[packageName]
    const packageSpec = extras
      ? `${packageName}[${extras.join(',')}]`
      : packageName
    pinnedPackage = `${packageSpec}==${version}`
  } else {
    pinnedPackage = getPinnedPackage(packageName)
  }

  if (!quiet) {
    logger.info(`Installing Python package: ${pinnedPackage}`)
  }

  try {
    const args = ['install']
    // Only use --user if no venv is available (venv doesn't need it)
    if (user && !venvAvailable) {
      args.push('--user')
    }
    if (upgrade) {
      args.push('--upgrade')
    }
    // On a PEP 668 managed system (Ubuntu 24.04, etc.) where no venv
    // is usable, pip refuses to touch the system interpreter without
    // --break-system-packages. We only reach this branch when the
    // venv path is unavailable (e.g. python3-venv not installed in a
    // build sandbox container), so the interpreter is intentionally
    // single-purpose and this opt-out is safe.
    if (!venvAvailable && isPEP668Managed()) {
      args.push('--break-system-packages')
    }
    // Prefer prebuilt binary wheels to avoid source compilation issues,
    // especially on Python 3.14+ where many packages don't have source compatibility yet.
    // This ensures packages like tokenizers use abi3 wheels.
    args.push('--only-binary=:all:')
    args.push(pinnedPackage)

    // Set PyO3 forward compatibility flag for Python 3.14+ support.
    // This allows packages like tokenizers (which use Rust/PyO3) to build
    // on newer Python versions than officially supported by using the stable ABI.
    // See: https://github.com/huggingface/tokenizers/issues/1639
    const pipEnv = {
      ...process.env,
      PYO3_USE_ABI3_FORWARD_COMPATIBILITY: '1',
    }

    // In quiet mode we pipe so we can inspect stderr for a PEP 668
    // rejection token on systems where the on-disk marker check
    // misses (e.g. a distro that stages EXTERNALLY-MANAGED elsewhere).
    // In verbose mode we inherit so the user sees pip progress live;
    // the marker-file check above is the primary signal in that path.
    const spawnOptions = quiet
      ? { env: pipEnv, stdio: 'pipe' }
      : { env: pipEnv, stdio: 'inherit' }

    let result = await spawn(pip, args, spawnOptions)
    let exitCode = result.code ?? 0

    // PEP 668 runtime retry (quiet mode only): if the marker file was
    // missing but pip still rejected with the externally-managed token,
    // retry once with --break-system-packages added. Verbose (inherit)
    // mode relies on the marker-file check above.
    const stderrText =
      typeof result.stderr === 'string'
        ? result.stderr
        : result.stderr instanceof Buffer
          ? result.stderr.toString('utf8')
          : ''
    if (
      exitCode !== 0 &&
      !venvAvailable &&
      !args.includes('--break-system-packages') &&
      stderrText.includes(PEP_668_ERROR_TOKEN)
    ) {
      cachedPEP668 = true
      const pepArgs = [...args]
      // Insert --break-system-packages before the trailing package
      // specifier so pip parses it as a flag, not as a package name.
      pepArgs.splice(pepArgs.length - 1, 0, '--break-system-packages')
      result = await spawn(pip, pepArgs, spawnOptions)
      exitCode = result.code ?? 0
    }

    if (exitCode !== 0 && args.includes('--only-binary=:all:')) {
      // Binary wheel not available (e.g., Python 3.14+ without prebuilt wheels).
      // Retry without --only-binary to allow source builds as fallback.
      if (!quiet) {
        logger.warn(
          `No binary wheel for ${packageName}, retrying with source build...`,
        )
      }
      const retryArgs = args.filter(a => a !== '--only-binary=:all:')
      // Preserve --break-system-packages on the source-build retry so
      // PEP 668 doesn't block it on Debian/Ubuntu.
      if (
        !venvAvailable &&
        isPEP668Managed() &&
        !retryArgs.includes('--break-system-packages')
      ) {
        retryArgs.splice(retryArgs.length - 1, 0, '--break-system-packages')
      }
      result = await spawn(pip, retryArgs, spawnOptions)
      exitCode = result.code ?? 0
    }

    if (exitCode !== 0) {
      if (!quiet) {
        printError(`Failed to install ${packageName}`)
      }
      return false
    }

    if (!quiet) {
      logger.success(`Installed ${packageName}`)
    }
    return true
  } catch (e) {
    if (!quiet) {
      printError(`Error installing ${packageName}: ${errorMessage(e)}`)
    }
    return false
  }
}

/**
 * Ensure a Python package is installed, installing if needed.
 *
 * @param {string} packageName - Package name to check/install.
 * @param {object} options - Options.
 * @param {string} options.importName - Import name if different from package name.
 * @param {boolean} options.autoInstall - Attempt auto-installation if missing (default: true).
 * @param {boolean} options.quiet - Suppress output (default: false).
 * @param {string} options.consumerPackageJsonPath - Optional path to consumer package.json for version overrides.
 * @returns {Promise<{available: boolean, installed: boolean}>}
 */
export async function ensurePythonPackage(
  packageName,
  {
    autoInstall = true,
    consumerPackageJsonPath,
    importName,
    quiet = false,
  } = {},
) {
  const checkName = importName || packageName

  // Check if package exists and get expected version
  // Use consumer overrides if provided
  let expectedVersion
  if (consumerPackageJsonPath) {
    // Convert package.json path to packageRoot for loadPythonVersions
    const packageRoot = path.dirname(consumerPackageJsonPath)
    const { PYTHON_VERSIONS: consumerVersions } = loadPythonVersions({
      packageRoot,
    })
    expectedVersion = consumerVersions[packageName]
  } else {
    expectedVersion = PYTHON_VERSIONS[packageName]
  }

  // Check if already installed with correct version
  const isInstalled = await checkPythonPackage(checkName)
  if (isInstalled && expectedVersion) {
    const hasCorrectVersion = await checkPythonPackageVersion(
      checkName,
      expectedVersion,
    )
    if (!hasCorrectVersion) {
      const pythonCmd = await getPythonCommand()
      try {
        const result = await spawn(
          pythonCmd,
          ['-c', `import ${checkName}; print(${checkName}.__version__)`],
          { stdio: 'pipe' },
        )
        const installedVersion = (result.stdout || '').trim()
        if (!quiet) {
          logger.warn(
            `Python package '${packageName}' version mismatch: installed ${installedVersion}, expected ${expectedVersion}`,
          )
        }
        // Version mismatch - need to reinstall
        if (autoInstall) {
          if (!quiet) {
            logger.substep(`Reinstalling ${packageName} with pinned version...`)
          }
          const installed = await installPythonPackage(packageName, {
            consumerPackageJsonPath,
            quiet,
            upgrade: true,
          })
          return { available: installed, installed }
        }
        return { available: false, installed: false }
      } catch {
        // Could not check version, proceed with reinstall if autoInstall
      }
    } else if (hasCorrectVersion) {
      return { available: true, installed: false }
    }
  } else if (isInstalled) {
    // No version pinning for this package, accept whatever is installed
    return { available: true, installed: false }
  }

  if (!autoInstall) {
    return { available: false, installed: false }
  }

  // Attempt to install.
  if (!quiet) {
    logger.substep(
      `Python package '${packageName}' not found, attempting to install...`,
    )
  }

  const installed = await installPythonPackage(packageName, {
    consumerPackageJsonPath,
    quiet,
  })

  return {
    available: installed,
    installed,
  }
}

/**
 * Ensure all required Python packages are installed.
 *
 * @param {Array<string|{name: string, importName?: string}>} packages - Packages to check.
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation (default: true).
 * @param {boolean} options.quiet - Suppress output (default: false).
 * @param {string} options.consumerPackageJsonPath - Optional path to consumer package.json for version overrides.
 * @returns {Promise<{allAvailable: boolean, missing: string[], installed: string[]}>}
 */
export async function ensureAllPythonPackages(
  packages,
  { autoInstall = true, consumerPackageJsonPath, quiet = false } = {},
) {
  const missing = []
  const installed = []

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i]
    const packageName = typeof pkg === 'string' ? pkg : pkg.name
    const importName = typeof pkg === 'string' ? undefined : pkg.importName

    if (!quiet && packages.length > 1) {
      logger.substep(`[${i + 1}/${packages.length}] Checking ${packageName}`)
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await ensurePythonPackage(packageName, {
        autoInstall,
        consumerPackageJsonPath,
        importName,
        quiet,
      })

      if (!result.available) {
        missing.push(packageName)
      } else if (result.installed) {
        installed.push(packageName)
      }
    } catch (e) {
      // ensurePythonPackage can throw from initializeVenv or from the
      // "No pinned version found" guard in installPythonPackage. Record
      // the package as missing and continue so the caller gets the full
      // picture instead of seeing the first exception abort the loop.
      if (!quiet) {
        logger.error(
          `Error checking Python package ${packageName}: ${errorMessage(e)}`,
        )
      }
      missing.push(packageName)
    }
  }

  // Summary
  if (!quiet && packages.length > 1) {
    if (missing.length === 0) {
      logger.success(
        `All Python packages available (${packages.length}/${packages.length}${installed.length > 0 ? `, ${installed.length} newly installed` : ''})`,
      )
    } else {
      logger.warn(
        `${packages.length - missing.length}/${packages.length} Python packages available (${missing.length} missing: ${missing.join(', ')})`,
      )
    }
  }

  return {
    allAvailable: missing.length === 0,
    installed,
    missing,
  }
}

/**
 * Get installation instructions for Python packages.
 *
 * @param {string[]} packages - Package names.
 * @returns {string[]} Array of installation instruction strings.
 */
export function getPythonPackageInstructions(packages) {
  const pinnedPackages = packages.map(pkg => getPinnedPackage(pkg))
  const instructions = ['Install required Python packages:']
  instructions.push(`  pip3 install --user ${pinnedPackages.join(' ')}`)
  return instructions
}

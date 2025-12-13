/**
 * Python Package Installation Utilities
 *
 * Provides utilities for automatically installing Python packages using pip.
 */

import path from 'node:path'

import binPkg from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import spawnPkg from '@socketsecurity/lib/spawn'

import { printError } from './build-output.mjs'
import {
  getPinnedPackage,
  PYTHON_VERSIONS,
  loadPythonVersions,
} from './pinned-versions.mjs'

const logger = getDefaultLogger()

const { whichSync } = binPkg
const { spawn } = spawnPkg

/**
 * Check if pip is available.
 *
 * @returns {boolean} True if pip is available.
 */
export function checkPipAvailable() {
  return !!(
    whichSync('pip3', { nothrow: true }) || whichSync('pip', { nothrow: true })
  )
}

/**
 * Get pip command (pip3 or pip).
 *
 * @returns {string|null} Resolved pip command path or null if not found.
 */
export function getPipCommand() {
  const pip3Path = whichSync('pip3', { nothrow: true })
  if (pip3Path) {
    return pip3Path
  }
  const pipPath = whichSync('pip', { nothrow: true })
  if (pipPath) {
    return pipPath
  }
  return null
}

/**
 * Check if a Python package is installed.
 *
 * @param {string} packageName - Package name to check.
 * @returns {Promise<boolean>} True if package is installed.
 */
export async function checkPythonPackage(packageName) {
  try {
    const python3Path = whichSync('python3', { nothrow: true })
    const pythonPath = whichSync('python', { nothrow: true })
    const pythonCmd = python3Path || pythonPath
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
    const python3Path = whichSync('python3', { nothrow: true })
    const pythonPath = whichSync('python', { nothrow: true })
    const pythonCmd = python3Path || pythonPath
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
    const installedVersion = result.stdout.trim()
    return installedVersion === expectedVersion
  } catch {
    return false
  }
}

/**
 * Install a Python package using pip.
 *
 * @param {string} packageName - Package name to install.
 * @param {object} options - Installation options.
 * @param {boolean} options.user - Install to user site-packages (--user flag).
 * @param {boolean} options.upgrade - Upgrade if already installed (--upgrade flag).
 * @param {boolean} options.quiet - Suppress output.
 * @param {string} options.consumerPackageJsonPath - Optional path to consumer package.json for version overrides.
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installPythonPackage(
  packageName,
  { consumerPackageJsonPath, quiet = false, upgrade = false, user = true } = {},
) {
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
    if (user) {
      args.push('--user')
    }
    if (upgrade) {
      args.push('--upgrade')
    }
    args.push(pinnedPackage)

    const result = await spawn(pip, args, {
      env: process.env,
      stdio: quiet ? 'pipe' : 'inherit',
    })

    const exitCode = result.code ?? 0
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
      printError(`Error installing ${packageName}: ${e.message}`)
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
      const python3Path = whichSync('python3', { nothrow: true })
      const pythonCmd = python3Path || whichSync('python', { nothrow: true })
      try {
        const result = await spawn(
          pythonCmd,
          ['-c', `import ${checkName}; print(${checkName}.__version__)`],
          { stdio: 'pipe' },
        )
        const installedVersion = result.stdout.trim()
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
            quiet,
            upgrade: true,
            consumerPackageJsonPath,
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
    quiet,
    consumerPackageJsonPath,
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

  for (const pkg of packages) {
    const packageName = typeof pkg === 'string' ? pkg : pkg.name
    const importName = typeof pkg === 'string' ? undefined : pkg.importName

    // eslint-disable-next-line no-await-in-loop
    const result = await ensurePythonPackage(packageName, {
      importName,
      autoInstall,
      quiet,
      consumerPackageJsonPath,
    })

    if (!result.available) {
      missing.push(packageName)
    } else if (result.installed) {
      installed.push(packageName)
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

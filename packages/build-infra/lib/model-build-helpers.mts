/**
 * Model build helper utilities.
 *
 * Provides DRY helper functions for ML model builders (minilm-builder,
 * codet5-models-builder, models package) to reduce code duplication.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  checkDiskSpace,
  checkPythonVersion,
  freeDiskSpace,
} from './build-helpers.mts'
import { printError } from './build-output.mts'
import { loadAllTools } from './pinned-versions.mts'
import { ensureAllPythonPackages } from './python-installer.mts'
import { ensureToolInstalled } from './tool-installer.mts'
import { getMinPythonVersion } from './version-helpers.mts'

const logger = getDefaultLogger()

/**
 * Extract Python packages from external-tools.json config.
 *
 * @param {object} externalTools - Tools config from loadAllTools()
 * @returns {Array<string|{name: string, importName: string}>} Python packages
 */
export function extractPythonPackages(externalTools) {
  return Object.entries(externalTools)
    .filter(([_, config]) => config.packageManager === 'pip')
    .map(([name]) => {
      // Handle packages that need special import names
      if (name === 'onnxruntime') {
        return { importName: 'onnxruntime', name }
      }
      return name
    })
}

/**
 * Run preflight checks for model builds.
 *
 * Centralizes the common prerequisite checks:
 * - Free disk space (CI cleanup)
 * - Check disk space availability
 * - Install/verify Python
 * - Check Python version
 * - Install/verify Python packages from external-tools.json
 *
 * @param {object} options - Check options
 * @param {string} options.packageRoot - Package root directory (for loading external-tools.json)
 * @param {string} options.packageJsonPath - Path to package.json (for pip install context)
 * @param {string} [options.buildDir] - Build directory (for disk space check)
 * @param {number} [options.requiredDiskGB=1] - Required disk space in GB
 * @param {boolean} [options.quiet=false] - Suppress output
 * @returns {Promise<{pythonPackages: Array, externalTools: object}>}
 */
export async function checkModelBuildPrerequisites(options) {
  const {
    buildDir,
    packageJsonPath,
    packageRoot,
    quiet = false,
    requiredDiskGB = 1,
  } = options

  if (!quiet) {
    logger.step('Pre-flight Checks')
  }

  // Free up disk space (CI environments).
  await freeDiskSpace()

  // Check disk space.
  if (buildDir) {
    const diskOk = await checkDiskSpace(
      buildDir,
      requiredDiskGB * 1024 * 1024 * 1024,
    )
    if (!diskOk) {
      if (!quiet) {
        logger.warn('Could not check disk space')
      }
    }
  }

  // Ensure Python 3 is installed.
  const requiredPythonVersion = getMinPythonVersion()
  const pythonResult = await ensureToolInstalled('python3', {
    autoInstall: true,
  })

  if (!pythonResult.available) {
    printError(`Python ${requiredPythonVersion}+ is required but not found`)
    printError('Install Python from: https://www.python.org/downloads/')
    throw new Error(`Python ${requiredPythonVersion}+ required`)
  }

  if (pythonResult.installed && !quiet) {
    logger.success('Installed Python 3')
  }

  // Check Python version.
  const pythonOk = await checkPythonVersion(requiredPythonVersion)
  if (!pythonOk) {
    printError(
      `Python ${requiredPythonVersion}+ required (found older version)`,
    )
    printError('Install Python from: https://www.python.org/downloads/')
    throw new Error(`Python ${requiredPythonVersion}+ required`)
  }

  // Load Python packages from external-tools.json (with extends support).
  const externalTools = loadAllTools({ packageRoot })
  const pythonPackages = extractPythonPackages(externalTools)

  // Ensure required Python packages are installed.
  if (!quiet) {
    logger.substep('Checking Python packages...')
  }

  const packagesResult = await ensureAllPythonPackages(pythonPackages, {
    autoInstall: true,
    consumerPackageJsonPath: packageJsonPath,
    quiet: false,
  })

  if (!packagesResult.allAvailable) {
    printError('Failed to install required Python packages:')
    for (const pkg of packagesResult.missing) {
      logger.error(`  - ${pkg}`)
    }
    logger.error('')
    logger.error('Please install manually:')
    logger.error(
      `  pip3 install --user ${pythonPackages.map(p => (typeof p === 'string' ? p : p.name)).join(' ')}`,
    )
    throw new Error('Missing Python dependencies')
  }

  if (packagesResult.installed.length > 0 && !quiet) {
    logger.success(
      `Installed Python packages: ${packagesResult.installed.join(', ')}`,
    )
  } else if (!quiet) {
    logger.success('All Python packages available')
  }

  if (!quiet) {
    logger.success('Pre-flight checks passed')
  }

  return {
    externalTools,
    pythonPackages,
  }
}

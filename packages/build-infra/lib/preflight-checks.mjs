/**
 * @fileoverview Preflight checks runner for build scripts.
 * Provides a DRY way to run common pre-build validation checks.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  checkCompiler,
  checkDiskSpace,
  checkPythonVersion,
} from './build-helpers.mjs'
import { printError } from './build-output.mjs'
import { getMinPythonVersion } from './version-helpers.mjs'

const logger = getDefaultLogger()

/**
 * Run preflight checks for build scripts.
 *
 * @param {object} options - Check options
 * @param {boolean} [options.disk=true] - Check disk space
 * @param {number} [options.diskGB=5] - Required disk space in GB
 * @param {boolean} [options.compiler=false] - Check for C++ compiler
 * @param {string|string[]} [options.compilers] - Specific compiler(s) to check
 * @param {boolean} [options.python=false] - Check Python version
 * @param {string} [options.pythonVersion] - Minimum Python version (defaults to external-tools.json minimumVersion)
 * @param {boolean} [options.quiet=false] - Suppress output
 * @param {boolean} [options.failFast=true] - Exit on first failure
 * @returns {Promise<{passed: boolean, failures: string[]}>}
 */
export async function runPreflightChecks(options = {}) {
  const {
    compiler = false,
    compilers,
    disk = true,
    diskGB = 5,
    failFast = true,
    python = false,
    pythonVersion,
    quiet = false,
  } = options

  // Use single source of truth from external-tools.json if no version specified
  const effectivePythonVersion = pythonVersion ?? getMinPythonVersion()

  const failures = []

  if (!quiet) {
    logger.step('Running preflight checks')
    logger.log('')
  }

  // Check disk space.
  if (disk) {
    const diskCheck = await checkDiskSpace('.', diskGB)
    if (!diskCheck.sufficient) {
      const msg = `Insufficient disk space: ${diskCheck.availableGB}GB available, ${diskGB}GB required`
      failures.push(msg)
      if (!quiet) {
        printError(msg)
      }
      if (failFast) {
        return { failures, passed: false }
      }
    }
  }

  // Check compiler.
  if (compiler) {
    const compilerCheck = await checkCompiler(compilers)
    if (!compilerCheck.available) {
      const msg = compilers
        ? `No C++ compiler found (tried: ${Array.isArray(compilers) ? compilers.join(', ') : compilers})`
        : 'No C++ compiler found'
      failures.push(msg)
      if (!quiet) {
        printError(msg)
      }
      if (failFast) {
        return { failures, passed: false }
      }
    }
  }

  // Check Python.
  if (python) {
    const pythonCheck = await checkPythonVersion(effectivePythonVersion)
    if (!pythonCheck.available) {
      const msg = `Python ${effectivePythonVersion}+ not found`
      failures.push(msg)
      if (!quiet) {
        printError(msg)
      }
      if (failFast) {
        return { failures, passed: false }
      }
    }
  }

  if (!quiet) {
    if (!failures.length) {
      logger.success('All preflight checks passed')
      logger.log('')
    } else {
      printError(`${failures.length} preflight check(s) failed`)
      logger.log('')
    }
  }

  return {
    failures,
    passed: !failures.length,
  }
}

/**
 * Run preflight checks and exit on failure.
 *
 * @param {object} options - Check options
 * @returns {Promise<void>}
 */
export async function runPreflightChecksOrExit(options = {}) {
  const result = await runPreflightChecks(options)

  if (!result.passed) {
    if (!options.quiet) {
      logger.error('Preflight checks failed')
      for (const failure of result.failures) {
        logger.error(`  - ${failure}`)
      }
    }
    throw new Error('Preflight checks failed')
  }
}

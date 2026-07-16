/**
 * Build Environment Detection and Setup.
 *
 * Re-exports toolchain and emscripten helpers and provides the top-level
 * `setupBuildEnvironment` orchestrator. Implementation split across:
 * - build-env-toolchain.mts  (command detection, Python, Rust, source flags)
 * - build-env-emscripten.mts (EMSDK detection and activation)
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getMinPythonVersion } from './version-helpers.mts'
import {
  activateEmscriptenSDK,
  getEmscriptenVersion,
} from './build-env-emscripten.mts'
import { checkPython, checkRust } from './build-env-toolchain.mts'

export * from './build-env-emscripten.mts'
export * from './build-env-toolchain.mts'

const logger = getDefaultLogger()

/**
 * Print environment setup results.
 */
export function printSetupResults(results: {
  errors: string[]
  messages: string[]
  success: boolean
}) {
  if (results.messages.length > 0) {
    logger.error('')
    logger.info('Build Environment:')
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const message of results.messages) {
      logger.info(`  ${message}`) // socket-lint: allow logger-decoration
    }
  }

  if (results.errors.length > 0) {
    logger.error('')
    logger.warn('Missing Prerequisites:')
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const error of results.errors) {
      logger.warn(`  ${error}`) // socket-lint: allow logger-decoration
    }
  }

  if (!results.success) {
    logger.fail('Build environment setup failed')
    logger.info('   Run setup script to install missing tools') // socket-lint: allow logger-decoration
    logger.error('')
  }
}

/**
 * Setup build environment for current package.
 *
 * Activates necessary toolchains and verifies prerequisites.
 * Returns object with status and any error messages.
 *
 * @param {Object} options - Setup options.
 * @param {boolean} options.emscripten - Require Emscripten SDK.
 * @param {boolean} options.rust - Require Rust with WASM support.
 * @param {boolean} options.python - Require Python (version from
 *   external-tools.json)
 * @param {boolean} options.autoSetup - Automatically run setup script if tools
 *   missing.
 *
 * @returns {Object} Setup result with status and messages
 */
export async function setupBuildEnvironment(
  options: {
    autoSetup?: boolean | undefined
    emscripten?: boolean | undefined
    python?: boolean | undefined
    rust?: boolean | undefined
  } = {},
) {
  const {
    autoSetup = true,
    emscripten = false,
    python = false,
    rust = false,
  } = options

  const results: { errors: string[]; messages: string[]; success: boolean } = {
    errors: [],
    messages: [],
    success: true,
  }

  if (emscripten) {
    const activated = await activateEmscriptenSDK()

    if (activated) {
      const version = await getEmscriptenVersion()
      // oxlint-disable-next-line socket/no-status-emoji -- emoji are pushed into result.messages/result.errors arrays that callers may render anywhere (JSON, file, stderr); there is no single logger.success/fail call to migrate to.
      results.messages.push(`✓ Emscripten ${version} activated`)
    } else {
      results.success = false
      // oxlint-disable-next-line socket/no-status-emoji -- emoji are pushed into result.messages/result.errors arrays that callers may render anywhere (JSON, file, stderr); there is no single logger.success/fail call to migrate to.
      results.errors.push('✗ Emscripten SDK not found')

      if (autoSetup) {
        results.errors.push(
          '  Run: node scripts/setup-build-toolchain.mts --emscripten',
        )
      } else {
        results.errors.push(
          '  Install from: https://emscripten.org/docs/getting_started/downloads.html',
        )
      }
    }
  }

  if (rust) {
    const rustCheck = await checkRust()

    if (rustCheck.available) {
      // oxlint-disable-next-line socket/no-status-emoji -- emoji are pushed into result.messages/result.errors arrays that callers may render anywhere (JSON, file, stderr); there is no single logger.success/fail call to migrate to.
      results.messages.push(`✓ Rust ${rustCheck.version} with WASM support`)
    } else {
      results.success = false
      // oxlint-disable-next-line socket/no-status-emoji -- emoji are pushed into result.messages/result.errors arrays that callers may render anywhere (JSON, file, stderr); there is no single logger.success/fail call to migrate to.
      results.errors.push(`✗ Rust: ${rustCheck.reason}`)

      if (rustCheck.fix) {
        results.errors.push(`  Fix: ${rustCheck.fix}`)
      } else if (autoSetup) {
        results.errors.push(
          '  Run: node scripts/setup-build-toolchain.mts --rust',
        )
      }
    }
  }

  if (python) {
    const pythonCheck = await checkPython()

    if (pythonCheck.available) {
      if (pythonCheck.meetsRequirement) {
        // oxlint-disable-next-line socket/no-status-emoji -- emoji are pushed into result.messages/result.errors arrays that callers may render anywhere (JSON, file, stderr); there is no single logger.success/fail call to migrate to.
        results.messages.push(`✓ Python ${pythonCheck.version}`)
      } else {
        results.success = false
        results.errors.push(
          // oxlint-disable-next-line socket/no-status-emoji -- emoji are pushed into result.messages/result.errors arrays that callers may render anywhere (JSON, file, stderr); there is no single logger.success/fail call to migrate to.
          `✗ Python ${pythonCheck.version} is too old (need ${getMinPythonVersion()}+)`,
        )

        if (autoSetup) {
          results.errors.push(
            '  Run: node scripts/setup-build-toolchain.mts --python',
          )
        }
      }
    } else {
      results.success = false
      // oxlint-disable-next-line socket/no-status-emoji -- emoji are pushed into result.messages/result.errors arrays that callers may render anywhere (JSON, file, stderr); there is no single logger.success/fail call to migrate to.
      results.errors.push(`✗ Python ${getMinPythonVersion()}+ not found`)

      if (autoSetup) {
        results.errors.push(
          '  Run: node scripts/setup-build-toolchain.mts --python',
        )
      }
    }
  }

  return results
}

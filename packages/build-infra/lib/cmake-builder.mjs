/**
 * CMake Build Helper
 *
 * Provides utilities for CMake-based builds with checkpointing and logging.
 */

import { cpus } from 'node:os'

import { which } from '@socketsecurity/lib/bin'
import platformPkg from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import spawnPkg from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const { WIN32 } = platformPkg
const { spawn } = spawnPkg

// Cache cmake path
let _cmakePath = null

export class CMakeBuilder {
  constructor(sourceDir, buildDir) {
    this.sourceDir = sourceDir
    this.buildDir = buildDir
  }

  /**
   * Configure CMake project.
   *
   * @param {object} options - CMake options as key-value pairs
   * @returns {Promise<void>}
   */
  async configure(options = {}) {
    logger.substep('Configuring CMake')

    if (!_cmakePath) {
      _cmakePath = await which('cmake', { nothrow: true })
      if (!_cmakePath) {
        throw new Error('cmake not found in PATH')
      }
    }

    const cmakeArgs = Object.entries(options).flatMap(([key, value]) => [
      `-D${key}=${value}`,
    ])

    const result = await spawn(
      _cmakePath,
      ['-S', this.sourceDir, '-B', this.buildDir, ...cmakeArgs],
      { shell: WIN32, stdio: 'inherit' },
    )
    if (result.code !== 0) {
      throw new Error(`cmake configure failed with exit code ${result.code}`)
    }
  }

  /**
   * Build CMake project.
   *
   * @param {object} options - Build options
   * @param {boolean} options.parallel - Use parallel jobs (default: true)
   * @param {string} options.target - Build target (default: 'all')
   * @returns {Promise<void>}
   */
  async build({ parallel = true, target = 'all' } = {}) {
    logger.substep('Building with CMake')

    if (!_cmakePath) {
      _cmakePath = await which('cmake', { nothrow: true })
      if (!_cmakePath) {
        throw new Error('cmake not found in PATH')
      }
    }

    const jobs = parallel ? cpus().length : 1
    const result = await spawn(
      _cmakePath,
      ['--build', this.buildDir, '--target', target, '-j', String(jobs)],
      { shell: WIN32, stdio: 'inherit' },
    )
    if (result.code !== 0) {
      throw new Error(`cmake build failed with exit code ${result.code}`)
    }
  }

  /**
   * Clean build directory.
   *
   * @returns {Promise<void>}
   */
  async clean() {
    logger.substep('Cleaning CMake build')

    if (!_cmakePath) {
      _cmakePath = await which('cmake', { nothrow: true })
      if (!_cmakePath) {
        throw new Error('cmake not found in PATH')
      }
    }

    const result = await spawn(
      _cmakePath,
      ['--build', this.buildDir, '--target', 'clean'],
      { shell: WIN32, stdio: 'inherit' },
    )
    if (result.code !== 0) {
      throw new Error(`cmake clean failed with exit code ${result.code}`)
    }
  }
}

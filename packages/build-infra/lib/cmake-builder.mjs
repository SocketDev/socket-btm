/**
 * CMake Build Helper
 *
 * Provides utilities for CMake-based builds with checkpointing and logging.
 */

import os from 'node:os'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

// Cache cmake path
let _cmakePath

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
      const errorMsg = [
        `CMake configuration failed with exit code ${result.code}`,
        '',
        'Common causes:',
        '  ✗ Missing build dependencies (gcc, g++, make)',
        '  ✗ Unsupported compiler version',
        '  ✗ Missing CMake modules or packages',
        '  ✗ Invalid CMake cache from previous build',
        '',
        'Troubleshooting:',
        `  1. Source directory: ${this.sourceDir}`,
        `  2. Build directory: ${this.buildDir}`,
        `  3. Check CMakeError.log in: ${this.buildDir}/CMakeFiles/`,
        '  4. Verify cmake version: cmake --version',
        `  5. Try clean build: rm -rf ${this.buildDir} && rebuild`,
      ].join('\n')
      throw new Error(errorMsg)
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

    const jobs = parallel ? os.cpus().length : 1
    const result = await spawn(
      _cmakePath,
      ['--build', this.buildDir, '--target', target, '-j', String(jobs)],
      { shell: WIN32, stdio: 'inherit' },
    )
    if (result.code !== 0) {
      const errorMsg = [
        `CMake build failed with exit code ${result.code}`,
        '',
        'Common causes:',
        '  ✗ Compilation errors in source code',
        '  ✗ Insufficient memory (try reducing parallel jobs)',
        '  ✗ Missing libraries or headers',
        '  ✗ Disk space exhausted',
        '',
        'Troubleshooting:',
        `  1. Build directory: ${this.buildDir}`,
        `  2. Target: ${target}`,
        `  3. Try sequential build: cmake --build ${this.buildDir} -j 1`,
        '  4. Check detailed errors in build log above',
        `  5. Check disk space: df -h ${this.buildDir}`,
      ].join('\n')
      throw new Error(errorMsg)
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
      const errorMsg = [
        `CMake clean failed with exit code ${result.code}`,
        '',
        'Common causes:',
        '  ✗ Build directory does not exist',
        '  ✗ Permission issues on build files',
        '  ✗ Files locked by another process',
        '',
        'Troubleshooting:',
        `  1. Build directory: ${this.buildDir}`,
        `  2. Try manual clean: rm -rf ${this.buildDir}`,
        `  3. Check permissions: ls -ld ${this.buildDir}`,
      ].join('\n')
      throw new Error(errorMsg)
    }
  }
}

/**
 * Emscripten SDK detection and activation helpers.
 *
 * Finds the EMSDK installation (env var, PATH, Homebrew, or known dirs) and
 * activates it by injecting environment variables into the current process.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  getEmsdkSearchPaths,
  HOMEBREW_CELLAR_EMSCRIPTEN_PATTERN,
} from './constants.mts'
import { errorMessage } from './error-utils.mts'
import {
  commandExists,
  getCommandOutput,
  getPlatform,
} from './build-env-toolchain.mts'

const logger = getDefaultLogger()

/**
 * Activate Emscripten SDK.
 *
 * Sets environment variables for current process to use Emscripten.
 * Returns true if successful, false otherwise.
 */
export async function activateEmscriptenSDK() {
  const emsdkInfo = await findEmscriptenSDK()

  if (!emsdkInfo) {
    return false
  }

  const { path: emsdkPath, type } = emsdkInfo

  try {
    if (type === 'homebrew') {
      process.env['EMSDK'] = emsdkPath
      process.env['EMSCRIPTEN'] = path.join(emsdkPath, 'libexec')
      return await commandExists('emcc')
    }

    const platform = getPlatform()

    if (platform === 'win32') {
      const envScript = path.join(emsdkPath, 'emsdk_env.bat')
      if (!existsSync(envScript)) {
        return false
      }

      const { stdout: envOutput } = await spawn(
        'cmd',
        ['/c', `"${envScript}" && set`],
        { stdio: 'pipe' },
      )

      const envLines = envOutput.split('\n')
      for (let i = 0, { length } = envLines; i < length; i += 1) {
        const line = envLines[i]
        // ^(EMSDK|EM_\w+|PATH): env var name; =: separator; (.*): value to end of line
        const match = line.match(/^(EMSDK|EM_\w+|PATH)=(.*)$/)
        if (match) {
          process.env[match[1]] = match[2].trim()
        }
      }
    } else {
      const envScript = path.join(emsdkPath, 'emsdk_env.sh')
      if (!existsSync(envScript)) {
        return false
      }

      const { stdout: envOutput } = await spawn(
        'bash',
        ['-c', `source ${envScript} > /dev/null 2>&1 && env`],
        { stdio: 'pipe' },
      )

      const envLines = envOutput.split('\n')
      for (let i = 0, { length } = envLines; i < length; i += 1) {
        const line = envLines[i]
        // ^(EMSDK|EM_\w+|PATH): env var name; =: separator; (.*): value to end of line
        const match = line.match(/^(EMSDK|EM_\w+|PATH)=(.*)$/)
        if (match) {
          process.env[match[1]] = match[2].trim()
        }
      }
    }

    return (await commandExists('emcc')) && Boolean(process.env['EMSDK'])
  } catch (e) {
    logger.fail(`Failed to activate Emscripten: ${errorMessage(e)}`)
    return false
  }
}

/**
 * Find Emscripten SDK installation.
 *
 * Searches common locations and returns path if found.
 *
 * @returns {Promise<{ path: string; type: 'emsdk' | 'homebrew' } | undefined>}
 *   Resolved SDK info, or undefined when no installation is found.
 */
export async function findEmscriptenSDK() {
  if (process.env['EMSDK'] && existsSync(process.env['EMSDK'])) {
    return { path: process.env['EMSDK'], type: 'emsdk' }
  }

  if (await commandExists('emcc')) {
    try {
      const isWin32 = getPlatform() === 'win32'
      const whichCommand = isWin32 ? 'where' : 'which'
      let emccPath = await getCommandOutput(whichCommand, ['emcc'])

      if (emccPath) {
        const platform = getPlatform()
        if (platform !== 'win32' && existsSync(emccPath)) {
          try {
            let realPath
            try {
              realPath = await getCommandOutput('readlink', ['-f', emccPath])
            } catch {
              realPath = await getCommandOutput('readlink', [emccPath])
            }
            if (realPath) {
              emccPath = realPath
            }
          } catch {
            // If readlink fails, continue with original path.
          }
        }

        if (emccPath.includes(HOMEBREW_CELLAR_EMSCRIPTEN_PATTERN)) {
          const match = emccPath.match(/(.*\/Cellar\/emscripten\/[^/]+)/)
          if (match) {
            const homebrewPath = match[1]
            const cmakeFile = path.join(
              homebrewPath,
              'libexec/cmake/Modules/Platform/Emscripten.cmake',
            )
            if (existsSync(cmakeFile)) {
              return { path: homebrewPath, type: 'homebrew' }
            }
          }
        }

        const emscriptenDir = path.dirname(emccPath)
        const upstreamDir = path.dirname(emscriptenDir)
        const emsdkPath = path.dirname(upstreamDir)

        const emsdkScript = path.join(
          emsdkPath,
          getPlatform() === 'win32' ? 'emsdk.bat' : 'emsdk',
        )

        if (existsSync(emsdkScript)) {
          return { path: emsdkPath, type: 'emsdk' }
        }
      }
    } catch {
      // Can't determine EMSDK path from emcc location.
    }
  }

  const searchPaths = getEmsdkSearchPaths(getPlatform())

  for (let i = 0, { length } = searchPaths; i < length; i += 1) {
    const emsdkPath = searchPaths[i]
    const emsdkScript = path.join(
      emsdkPath,
      getPlatform() === 'win32' ? 'emsdk.bat' : 'emsdk',
    )

    if (existsSync(emsdkScript)) {
      return { path: emsdkPath, type: 'emsdk' }
    }
  }

  return undefined
}

/**
 * Get Emscripten version from the installed emcc binary.
 *
 * Note: this detects the runtime emcc version; for the configured/pinned
 * version from external-tools.json see `build-infra/lib/version-helpers`.
 */
export async function getEmscriptenVersion() {
  if (!(await commandExists('emcc'))) {
    return undefined
  }

  try {
    const version = await getCommandOutput('emcc', ['--version'])
    const match = version.match(/emcc.*?(\d+\.\d+\.\d+)/)
    return match ? match[1] : undefined
  } catch {
    return undefined
  }
}

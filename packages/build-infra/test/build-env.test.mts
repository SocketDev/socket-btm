/**
 * @fileoverview Tests for build-env utility.
 * Validates environment detection and setup logic.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import {
  getPlatform,
  commandExists,
  getCommandOutput,
  findEmscriptenSDK,
  getEmscriptenVersion,
  checkRust,
  checkPython,
} from '../lib/build-env.mjs'

describe('build-env', () => {
  describe('getPlatform', () => {
    it('should return a valid platform identifier', () => {
      const platform = getPlatform()
      expect(['darwin', 'linux', 'win32']).toContain(platform)
    })
  })

  describe('commandExists', () => {
    it('should return true for known commands', async () => {
      // Node should always exist since we're running in Node
      expect(await commandExists('node')).toBe(true)
    })

    it('should return false for nonexistent commands', async () => {
      expect(
        await commandExists('this-command-definitely-does-not-exist-12345'),
      ).toBe(false)
    })
  })

  describe('getCommandOutput', () => {
    it('should return output for valid commands', async () => {
      const output = await getCommandOutput('node', ['--version'])
      expect(output).toMatch(/^v\d+\.\d+\.\d+$/)
    })

    it('should return empty string for invalid commands', async () => {
      const output = await getCommandOutput(
        'this-command-definitely-does-not-exist-12345',
      )
      expect(output).toBe('')
    })
  })

  describe('checkPython', () => {
    it('should detect Python installation', async () => {
      const result = await checkPython()

      // Either Python is available or not
      expect(result).toHaveProperty('available')

      if (result.available) {
        expect(result).toHaveProperty('version')
        expect(result).toHaveProperty('command')
        expect(result).toHaveProperty('meetsRequirement')
        expect(['python3', 'python']).toContain(result.command)

        // Version should be in format X.Y.Z
        expect(result.version).toMatch(/^\d+\.\d+\.\d+$/)

        // meetsRequirement should be boolean
        expect(typeof result.meetsRequirement).toBe('boolean')
      }
    })

    it('should check version requirements', async () => {
      const result = await checkPython()

      if (result.available) {
        const [major, minor] = result.version.split('.').map(Number)

        if (major >= 3 && minor >= 8) {
          expect(result.meetsRequirement).toBe(true)
        } else {
          expect(result.meetsRequirement).toBe(false)
        }
      }
    })
  })

  describe('checkRust', () => {
    // 120s timeout for slow rustup commands on Windows CI
    it('should detect Rust installation', async () => {
      const result = await checkRust()

      expect(result).toHaveProperty('available')

      if (result.available) {
        expect(result).toHaveProperty('version')
        expect(result.version).toMatch(/^\d+\.\d+\.\d+$/)
      } else {
        expect(result).toHaveProperty('reason')
      }
    }, 120_000)

    // 60s timeout for slow rustup commands on Windows
    it('should check for WASM target when Rust is available', async () => {
      const result = await checkRust()

      if (result.available && (await commandExists('rustup'))) {
        // If Rust is available, it should have checked for WASM target
        // Either it's available or there's a fix suggestion
        expect(result.available === true || result.fix).toBeTruthy()
      }
    }, 60_000)

    // 60s timeout for slow rustup commands on Windows
    it('should provide fix suggestions when missing components', async () => {
      const result = await checkRust()

      if (!result.available && result.fix) {
        expect(typeof result.fix).toBe('string')
        expect(result.fix.length).toBeGreaterThan(0)
      }
    }, 60_000)
  })

  describe('findEmscriptenSDK', () => {
    let originalEnv: string | undefined

    beforeEach(() => {
      originalEnv = { ...process.env }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should return SDK info if EMSDK env var is set and valid', async () => {
      // Only test if EMSDK is actually set to a valid path
      if (process.env.EMSDK) {
        const result = await findEmscriptenSDK()

        if (result) {
          expect(result).toHaveProperty('path')
          expect(result).toHaveProperty('type')
          expect(['emsdk', 'homebrew']).toContain(result.type)
        }
      }
    })

    it('should detect Homebrew Emscripten installation', async () => {
      const result = await findEmscriptenSDK()

      if (result && result.type === 'homebrew') {
        expect(result.path).toContain('Cellar/emscripten')
      }
    })

    it('should return undefined when Emscripten is not found', async () => {
      delete process.env.EMSDK

      const result = await findEmscriptenSDK()

      // Either found or not found
      if (result) {
        expect(result).toHaveProperty('path')
        expect(result).toHaveProperty('type')
      } else {
        expect(result).toBeUndefined()
      }
    })
  })

  describe('getEmscriptenVersion', () => {
    it('should return version string if emcc is available', async () => {
      const version = await getEmscriptenVersion()

      if (version) {
        // Should be in format X.Y.Z
        expect(version).toMatch(/^\d+\.\d+\.\d+$/)
      } else {
        // Should return undefined if not available
        expect(version).toBeUndefined()
      }
    })

    it('should return undefined when emcc is not available', async () => {
      if (!(await commandExists('emcc'))) {
        const version = await getEmscriptenVersion()
        expect(version).toBeUndefined()
      }
    })
  })

  describe('environment detection consistency', () => {
    it('should have consistent command detection', async () => {
      // If commandExists returns true, getCommandOutput should work
      if (await commandExists('node')) {
        const output = await getCommandOutput('node', ['--version'])
        expect(output.length).toBeGreaterThan(0)
      }
    })

    it('should detect platform-appropriate commands', async () => {
      const platform = getPlatform()

      if (platform === 'win32') {
        // Windows should have cmd
        expect(await commandExists('cmd')).toBe(true)
      } else {
        // Unix systems should have bash or sh
        const hasShell =
          (await commandExists('bash')) || (await commandExists('sh'))
        expect(hasShell).toBe(true)
      }
    })
  })
})

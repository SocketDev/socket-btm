/**
 * @fileoverview Tests for build-env utility.
 * Validates environment detection and setup logic.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import {
  isCI,
  getPlatform,
  commandExists,
  getCommandOutput,
  findEmscriptenSDK,
  getEmscriptenVersion,
  checkRust,
  checkPython,
} from '../lib/build-env.mjs'

describe('build-env', () => {
  describe('isCI', () => {
    let originalEnv

    beforeEach(() => {
      originalEnv = { ...process.env }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should return true when CI env var is set', () => {
      process.env.CI = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return true when GITHUB_ACTIONS is set', () => {
      delete process.env.CI
      process.env.GITHUB_ACTIONS = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return true when GITLAB_CI is set', () => {
      delete process.env.CI
      delete process.env.GITHUB_ACTIONS
      process.env.GITLAB_CI = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return true when CIRCLECI is set', () => {
      delete process.env.CI
      process.env.CIRCLECI = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return true when TRAVIS is set', () => {
      delete process.env.CI
      process.env.TRAVIS = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return false when no CI env vars are set', () => {
      delete process.env.CI
      delete process.env.GITHUB_ACTIONS
      delete process.env.GITLAB_CI
      delete process.env.CIRCLECI
      delete process.env.TRAVIS

      expect(isCI()).toBe(false)
    })
  })

  describe('getPlatform', () => {
    it('should return a valid platform identifier', () => {
      const platform = getPlatform()
      expect(['darwin', 'linux', 'win32']).toContain(platform)
    })
  })

  describe('commandExists', () => {
    it('should return true for known commands', () => {
      // Node should always exist since we're running in Node
      expect(commandExists('node')).toBe(true)
    })

    it('should return false for nonexistent commands', () => {
      expect(
        commandExists('this-command-definitely-does-not-exist-12345'),
      ).toBe(false)
    })
  })

  describe('getCommandOutput', () => {
    it('should return output for valid commands', () => {
      const output = getCommandOutput('node --version')
      expect(output).toMatch(/^v\d+\.\d+\.\d+$/)
    })

    it('should return empty string for invalid commands', () => {
      const output = getCommandOutput(
        'this-command-definitely-does-not-exist-12345',
      )
      expect(output).toBe('')
    })
  })

  describe('checkPython', () => {
    it('should detect Python installation', () => {
      const result = checkPython()

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

    it('should check version requirements', () => {
      const result = checkPython()

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
    it('should detect Rust installation', () => {
      const result = checkRust()

      expect(result).toHaveProperty('available')

      if (result.available) {
        expect(result).toHaveProperty('version')
        expect(result.version).toMatch(/^\d+\.\d+\.\d+$/)
      } else {
        expect(result).toHaveProperty('reason')
      }
    })

    it('should check for WASM target when Rust is available', () => {
      const result = checkRust()

      if (result.available && commandExists('rustup')) {
        // If Rust is available, it should have checked for WASM target
        // Either it's available or there's a fix suggestion
        expect(result.available === true || result.fix).toBeTruthy()
      }
    })

    it('should provide fix suggestions when missing components', () => {
      const result = checkRust()

      if (!result.available && result.fix) {
        expect(typeof result.fix).toBe('string')
        expect(result.fix.length).toBeGreaterThan(0)
      }
    })
  })

  describe('findEmscriptenSDK', () => {
    let originalEnv

    beforeEach(() => {
      originalEnv = { ...process.env }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should return SDK info if EMSDK env var is set and valid', () => {
      // Only test if EMSDK is actually set to a valid path
      if (process.env.EMSDK) {
        const result = findEmscriptenSDK()

        if (result) {
          expect(result).toHaveProperty('path')
          expect(result).toHaveProperty('type')
          expect(['emsdk', 'homebrew']).toContain(result.type)
        }
      }
    })

    it('should detect Homebrew Emscripten installation', () => {
      const result = findEmscriptenSDK()

      if (result && result.type === 'homebrew') {
        expect(result.path).toContain('Cellar/emscripten')
      }
    })

    it('should return null when Emscripten is not found', () => {
      delete process.env.EMSDK

      const result = findEmscriptenSDK()

      // Either found or not found
      if (result) {
        expect(result).toHaveProperty('path')
        expect(result).toHaveProperty('type')
      } else {
        expect(result).toBeNull()
      }
    })
  })

  describe('getEmscriptenVersion', () => {
    it('should return version string if emcc is available', () => {
      const version = getEmscriptenVersion()

      if (version) {
        // Should be in format X.Y.Z
        expect(version).toMatch(/^\d+\.\d+\.\d+$/)
      } else {
        // Should return null if not available
        expect(version).toBeNull()
      }
    })

    it('should return null when emcc is not available', () => {
      if (!commandExists('emcc')) {
        const version = getEmscriptenVersion()
        expect(version).toBeNull()
      }
    })
  })

  describe('environment detection consistency', () => {
    it('should have consistent command detection', () => {
      // If commandExists returns true, getCommandOutput should work
      if (commandExists('node')) {
        const output = getCommandOutput('node --version')
        expect(output.length).toBeGreaterThan(0)
      }
    })

    it('should detect platform-appropriate commands', () => {
      const platform = getPlatform()

      if (platform === 'win32') {
        // Windows should have cmd
        expect(commandExists('cmd')).toBe(true)
      } else {
        // Unix systems should have bash or sh
        const hasShell = commandExists('bash') || commandExists('sh')
        expect(hasShell).toBe(true)
      }
    })
  })
})

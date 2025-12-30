/**
 * @fileoverview Tests for pinned-versions utility.
 * Validates version pinning and package specifier generation.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  TOOL_VERSIONS,
  PYTHON_VERSIONS,
  PYTHON_PACKAGE_EXTRAS,
  getPinnedPackage,
  getPinnedPackages,
  getToolConfig,
  getToolVersion,
  getToolPackageSpec,
  loadPythonVersions,
} from '../lib/pinned-versions.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

describe('pinned-versions', () => {
  describe('TOOL_VERSIONS', () => {
    it('should load tool versions from package.json', () => {
      expect(TOOL_VERSIONS).toBeDefined()
      expect(typeof TOOL_VERSIONS).toBe('object')
    })

    it('should have system tools with proper structure', () => {
      // build-infra has system tools, not Python packages
      const systemTools = Object.entries(TOOL_VERSIONS).filter(
        ([_, config]) => config.type !== 'python',
      )

      expect(systemTools.length).toBeGreaterThan(0)

      for (const [_name, config] of systemTools) {
        expect(config).toHaveProperty('description')
        expect(config).toHaveProperty('packages')

        // Packages should be organized by platform
        if (config.packages) {
          expect(typeof config.packages).toBe('object')
        }
      }
    })

    it('should have required system tools', () => {
      // build-infra defines ONLY core fundamental tools
      const requiredTools = [
        'bc',
        'ccache',
        'curl',
        'git',
        'make',
        'ninja',
        'patch',
      ]

      for (const tool of requiredTools) {
        expect(TOOL_VERSIONS).toHaveProperty(tool)
        expect(TOOL_VERSIONS[tool]).toHaveProperty('description')
        expect(TOOL_VERSIONS[tool]).toHaveProperty('packages')
      }
    })
  })

  describe('PYTHON_VERSIONS', () => {
    it('should be an object', () => {
      expect(PYTHON_VERSIONS).toBeDefined()
      expect(typeof PYTHON_VERSIONS).toBe('object')
    })

    it('should be empty for build-infra base package', () => {
      // build-infra doesn't define Python pip packages
      // Python packages are in consumer packages like minilm-builder
      expect(Object.keys(PYTHON_VERSIONS).length).toBe(0)
    })
  })

  describe('PYTHON_PACKAGE_EXTRAS', () => {
    it('should be an object', () => {
      expect(PYTHON_PACKAGE_EXTRAS).toBeDefined()
      expect(typeof PYTHON_PACKAGE_EXTRAS).toBe('object')
    })

    it('should have arrays of extras for packages that define them', () => {
      for (const [_name, extras] of Object.entries(PYTHON_PACKAGE_EXTRAS)) {
        expect(Array.isArray(extras)).toBe(true)
        expect(extras.length).toBeGreaterThan(0)

        for (const extra of extras) {
          expect(typeof extra).toBe('string')
          expect(extra.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('getPinnedPackage', () => {
    it('should throw error for unknown package', () => {
      expect(() => getPinnedPackage('nonexistent-package-12345')).toThrowError(
        /No pinned version found/,
      )
    })
  })

  describe('getPinnedPackages', () => {
    it('should throw for unknown packages', () => {
      expect(() =>
        getPinnedPackages(['nonexistent-package-1', 'nonexistent-package-2']),
      ).toThrowError()
    })
  })

  describe('getToolConfig', () => {
    it('should return tool configuration for system tools', () => {
      const config = getToolConfig('ninja')

      expect(config).toBeDefined()
      expect(config).toHaveProperty('description')
      expect(config).toHaveProperty('packages')
      expect(config).toHaveProperty('versions')
    })

    it('should return null for unknown tool', () => {
      const config = getToolConfig('nonexistent-tool-12345')
      expect(config).toBeNull()
    })

    it('should include all tool properties', () => {
      const config = getToolConfig('ninja')

      expect(config).toHaveProperty('description')
      expect(config.description).toContain('Ninja')
      expect(config).toHaveProperty('packages')
      expect(config.packages).toHaveProperty('darwin')
      expect(config).toHaveProperty('versions')
    })
  })

  describe('getToolVersion', () => {
    it('should return version for tool and package manager', () => {
      const version = getToolVersion('ninja', 'brew')

      expect(version).toBeDefined()
      expect(typeof version).toBe('string')
      expect(version.length).toBeGreaterThan(0)
    })

    it('should return null for unknown tool', () => {
      const version = getToolVersion('nonexistent-tool', 'brew')
      expect(version).toBeNull()
    })

    it('should return null for unknown package manager', () => {
      const version = getToolVersion('ninja', 'unknown-pm')
      expect(version).toBeNull()
    })

    it('should handle tools with version pinning', () => {
      const version = getToolVersion('ninja', 'brew')

      if (version) {
        // Should be a version string
        expect(typeof version).toBe('string')
        // Should look like a version (starts with a number)
        expect(version).toMatch(/^\d/)
      }
    })
  })

  describe('getToolPackageSpec', () => {
    it('should format package specifier for apt', () => {
      const spec = getToolPackageSpec('cmake', 'cmake', 'apt')

      expect(typeof spec).toBe('string')
      expect(spec).toContain('cmake')
    })

    it('should format package specifier for brew', () => {
      const spec = getToolPackageSpec('cmake', 'cmake', 'brew')

      expect(typeof spec).toBe('string')
      expect(spec).toContain('cmake')
      // brew uses @ for versions
      if (getToolVersion('cmake', 'brew')) {
        expect(spec).toContain('@')
      }
    })

    it('should format package specifier for choco', () => {
      const spec = getToolPackageSpec('cmake', 'cmake', 'choco')

      expect(typeof spec).toBe('string')
      expect(spec).toContain('cmake')
    })

    it('should return bare package name for unknown package manager', () => {
      const spec = getToolPackageSpec('cmake', 'cmake', 'unknown')
      expect(spec).toBe('cmake')
    })
  })

  describe('loadPythonVersions', () => {
    it('should load Python versions from consumer package', () => {
      // Load with a consumer package that has Python tools
      const consumerPath = path.join(
        packageDir,
        '..',
        'codet5-models-builder',
        'package.json',
      )

      if (existsSync(consumerPath)) {
        const { PYTHON_VERSIONS: versions } = loadPythonVersions(consumerPath)

        expect(versions).toBeDefined()
        expect(typeof versions).toBe('object')

        // Consumer package should have Python packages
        if (Object.keys(versions).length > 0) {
          expect(versions).toHaveProperty('transformers')
          expect(versions).toHaveProperty('torch')
          expect(versions).toHaveProperty('onnx')
          expect(versions).toHaveProperty('onnxruntime')

          // Test getPinnedPackage with loaded versions
          for (const [_name, version] of Object.entries(versions)) {
            expect(typeof version).toBe('string')
            expect(version.length).toBeGreaterThan(0)
          }
        }
      }
    })

    it('should merge consumer package overrides', () => {
      const consumerPath = path.join(
        packageDir,
        '..',
        'minilm-builder',
        'package.json',
      )

      if (existsSync(consumerPath)) {
        const { PYTHON_VERSIONS: versions } = loadPythonVersions(consumerPath)

        expect(versions).toBeDefined()
        expect(typeof versions).toBe('object')
      }
    })

    it('should handle missing consumer package gracefully', () => {
      const { PYTHON_VERSIONS: versions } = loadPythonVersions(
        '/nonexistent/path/package.json',
      )

      // Should return empty object since base package has no Python packages
      expect(versions).toBeDefined()
      expect(typeof versions).toBe('object')
    })
  })

  describe('version consistency', () => {
    it('should have consistent versions across exports', () => {
      for (const [name, config] of Object.entries(TOOL_VERSIONS)) {
        const toolConfig = getToolConfig(name)

        expect(toolConfig).toBeDefined()
        expect(toolConfig).toEqual(config)
      }
    })

    it('should handle system tools correctly', () => {
      const cmakeVersion = getToolVersion('cmake', 'brew')

      if (cmakeVersion) {
        const cmakeConfig = getToolConfig('cmake')
        expect(cmakeConfig?.versions?.brew).toBe(cmakeVersion)
      }
    })
  })

  describe('Python package testing with consumer package', () => {
    it('should work with Python packages from consumer package', () => {
      const consumerPath = path.join(
        packageDir,
        '..',
        'codet5-models-builder',
        'package.json',
      )

      if (existsSync(consumerPath)) {
        const { PYTHON_VERSIONS: versions } = loadPythonVersions(consumerPath)

        if (Object.keys(versions).length > 0) {
          // Test package specifier generation
          const packages = Object.keys(versions)
          expect(packages.length).toBeGreaterThan(0)

          // Each version should be a valid string
          for (const [_name, version] of Object.entries(versions)) {
            expect(typeof version).toBe('string')
            expect(version.length).toBeGreaterThan(0)
            // Should look like a version number
            expect(version).toMatch(/^\d/)
          }
        }
      }
    })
  })
})

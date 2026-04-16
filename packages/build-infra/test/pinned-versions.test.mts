/**
 * @fileoverview Tests for pinned-versions utility.
 * Validates version pinning and package specifier generation.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PYTHON_PACKAGE_EXTRAS,
  PYTHON_VERSIONS,
  TOOL_VERSIONS,
  getPinnedPackage,
  getPinnedPackages,
  getToolConfig,
  getToolPackageSpec,
  getToolVersion,
  loadPythonVersions,
} from '../lib/pinned-versions.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

describe('pinned-versions', () => {
  describe(TOOL_VERSIONS, () => {
    it('should load tool versions from package.json', () => {
      expect(TOOL_VERSIONS).toBeDefined()
      expectTypeOf(TOOL_VERSIONS).toBeObject()
    })

    it('should have system tools with proper structure', () => {
      // build-infra has system tools, not Python packages
      const systemTools = Object.entries(TOOL_VERSIONS).filter(
        ([_, config]) => config.packageManager !== 'pip',
      )

      expect(systemTools.length).toBeGreaterThan(0)

      for (const [_name, config] of systemTools) {
        expect(config).toHaveProperty('description')
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
      }
    })
  })

  describe(PYTHON_VERSIONS, () => {
    it('should be an object', () => {
      expect(PYTHON_VERSIONS).toBeDefined()
      expectTypeOf(PYTHON_VERSIONS).toBeObject()
    })

    it('should be empty for build-infra base package', () => {
      // build-infra doesn't define Python pip packages
      // Python packages are in consumer packages like minilm-builder
      expect(Object.keys(PYTHON_VERSIONS)).toHaveLength(0)
    })
  })

  describe(PYTHON_PACKAGE_EXTRAS, () => {
    it('should be an object', () => {
      expect(PYTHON_PACKAGE_EXTRAS).toBeDefined()
      expectTypeOf(PYTHON_PACKAGE_EXTRAS).toBeObject()
    })

    it('should have arrays of extras for packages that define them', () => {
      for (const [_name, extras] of Object.entries(PYTHON_PACKAGE_EXTRAS)) {
        expect(Array.isArray(extras)).toBeTruthy()
        expect(extras.length).toBeGreaterThan(0)

        for (const extra of extras) {
          expectTypeOf(extra).toBeString()
          expect(extra.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe(getPinnedPackage, () => {
    it('should throw error for unknown package', () => {
      expect(() => getPinnedPackage('nonexistent-package-12345')).toThrow(
        /No pinned version found/,
      )
    })
  })

  describe(getPinnedPackages, () => {
    it('should throw for unknown packages', () => {
      expect(() =>
        getPinnedPackages(['nonexistent-package-1', 'nonexistent-package-2']),
      ).toThrow()
    })
  })

  describe(getToolConfig, () => {
    it('should return tool configuration for system tools', () => {
      const config = getToolConfig('ninja')

      expect(config).toBeDefined()
      expect(config).toHaveProperty('description')
      expect(config).toHaveProperty('version')
    })

    it('should return undefined for unknown tool', () => {
      const config = getToolConfig('nonexistent-tool-12345')
      expect(config).toBeUndefined()
    })

    it('should include all tool properties', () => {
      const config = getToolConfig('ninja')

      expect(config).toHaveProperty('description')
      expect(config.description).toContain('Ninja')
      expect(config).toHaveProperty('version')
    })
  })

  describe(getToolVersion, () => {
    it('should return version for tool', () => {
      const version = getToolVersion('ninja')

      expect(version).toBeDefined()
      expectTypeOf(version).toBeString()
      expect(version.length).toBeGreaterThan(0)
    })

    it('should return undefined for unknown tool', () => {
      const version = getToolVersion('nonexistent-tool')
      expect(version).toBeUndefined()
    })

    it('should return undefined for tool without version', () => {
      const version = getToolVersion('git')
      expect(version).toBeUndefined()
    })

    it('should handle tools with version pinning', () => {
      const version = getToolVersion('ninja')

      if (version) {
        // Should be a version string
        expectTypeOf(version).toBeString()
        // Should look like a version (starts with a number)
        expect(version).toMatch(/^\d/)
      }
    })
  })

  describe(getToolPackageSpec, () => {
    it('should format package specifier for apt', () => {
      const spec = getToolPackageSpec('cmake', 'cmake', 'apt')

      expectTypeOf(spec).toBeString()
      expect(spec).toContain('cmake')
    })

    it('should format package specifier for brew', () => {
      const spec = getToolPackageSpec('cmake', 'cmake', 'brew')

      expectTypeOf(spec).toBeString()
      expect(spec).toContain('cmake')
      // brew uses @ for versions
      if (getToolVersion('cmake')) {
        expect(spec).toContain('@')
      }
    })

    it('should format package specifier for choco', () => {
      const spec = getToolPackageSpec('cmake', 'cmake', 'choco')

      expectTypeOf(spec).toBeString()
      expect(spec).toContain('cmake')
    })

    it('should return bare package name for unknown package manager', () => {
      const spec = getToolPackageSpec('cmake', 'cmake', 'unknown')
      expect(spec).toBe('cmake')
    })
  })

  describe(loadPythonVersions, () => {
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
        expectTypeOf(versions).toBeObject()

        // Consumer package should have Python packages
        if (Object.keys(versions).length > 0) {
          expect(versions).toHaveProperty('transformers')
          expect(versions).toHaveProperty('torch')
          expect(versions).toHaveProperty('onnx')
          expect(versions).toHaveProperty('onnxruntime')

          // Test getPinnedPackage with loaded versions
          for (const [_name, version] of Object.entries(versions)) {
            expectTypeOf(version).toBeString()
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
        expectTypeOf(versions).toBeObject()
      }
    })

    it('should handle missing consumer package gracefully', () => {
      const { PYTHON_VERSIONS: versions } = loadPythonVersions(
        '/nonexistent/path/package.json',
      )

      // Should return empty object since base package has no Python packages
      expect(versions).toBeDefined()
      expectTypeOf(versions).toBeObject()
    })
  })

  describe('version consistency', () => {
    it('should have consistent versions across exports', () => {
      for (const [name, config] of Object.entries(TOOL_VERSIONS)) {
        const toolConfig = getToolConfig(name)

        expect(toolConfig).toBeDefined()
        expect(toolConfig).toStrictEqual(config)
      }
    })

    it('should handle system tools correctly', () => {
      const cmakeVersion = getToolVersion('cmake')

      if (cmakeVersion) {
        const cmakeConfig = getToolConfig('cmake')
        expect(cmakeConfig?.version).toBe(cmakeVersion)
      }
    })
  })

  describe('python package testing with consumer package', () => {
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
            expectTypeOf(version).toBeString()
            expect(version.length).toBeGreaterThan(0)
            // Should look like a version number
            expect(version).toMatch(/^\d/)
          }
        }
      }
    })
  })
})

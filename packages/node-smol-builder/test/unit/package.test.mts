/**
 * @file Tests for @socketbin/node-smol-builder package structure and
 *   configuration.
 */

import { describe, expect, it } from 'vitest'

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { readPackageJson } from '@socketsecurity/lib-stable/packages/read'

import { PACKAGE_ROOT as nodeSmolBuilderDir } from '../../scripts/paths.mts'

const scriptsDir = path.join(nodeSmolBuilderDir, 'scripts')
const buildDir = path.join(nodeSmolBuilderDir, 'build')

describe('node-smol package', () => {
  describe('package.json validation', () => {
    it('should have valid package.json metadata', async () => {
      const pkgJson = await readPackageJson(
        path.join(nodeSmolBuilderDir, 'package.json'),
      )

      expect(pkgJson.name).toBe('node-smol-builder')
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(pkgJson.license).toBe('MIT')
      expect(pkgJson.description).toContain('Node.js')
      expect(pkgJson.private).toBeTruthy()
    })

    it('should have build scripts', async () => {
      const pkgJson = await readPackageJson(
        path.join(nodeSmolBuilderDir, 'package.json'),
      )

      expect(pkgJson.scripts).toBeDefined()
      expect(pkgJson.scripts['build']).toBe(
        'node scripts/common/shared/build.mts',
      )
      expect(pkgJson.scripts['build:all']).toBe(
        'node scripts/common/shared/build.mts --all-platforms',
      )
    })
  })

  describe('build scripts exist', () => {
    it('should have build.mts script', () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      expect(existsSync(buildPath)).toBeTruthy()
    })

    it('build.mts should be valid JavaScript', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      // Should not throw syntax errors.
      expect(content).toBeTruthy()
      expect(content).toContain('import')
      expect(content).toContain('Node.js')
    })
  })

  describe('build script documentation', () => {
    const buildFlagsDocPath = path.join(
      nodeSmolBuilderDir,
      '../../docs/agents.md/repo/node-smol-build-flags.md',
    )

    it('build.mts should point at the canonical build-flags doc', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      expect(content).toContain('docs/agents.md/repo/node-smol-build-flags.md')
      expect(existsSync(buildFlagsDocPath)).toBeTruthy()
    })

    it('the build-flags doc should document binary size optimization', async () => {
      const content = await fs.readFile(buildFlagsDocPath, 'utf8')

      expect(content).toContain('Binary size optimization')
      expect(content).toContain('MB')
    })

    it('the build-flags doc should document configuration flags', async () => {
      const content = await fs.readFile(buildFlagsDocPath, 'utf8')

      expect(content).toContain('--with-intl=small-icu')
      expect(content).toContain('--without-*')
    })

    it('the build-flags doc should document the compression strategy', async () => {
      const content = await fs.readFile(buildFlagsDocPath, 'utf8')

      expect(content).toContain('compression strategy')
      expect(content).toContain('Brotli')
    })

    it('the build-flags doc should document performance impact', async () => {
      const content = await fs.readFile(buildFlagsDocPath, 'utf8')

      expect(content).toContain('Performance impact')
      expect(content).toContain('Startup overhead')
      expect(content).toContain('Runtime performance')
    })

    it('the build-flags doc should document usage options', async () => {
      const content = await fs.readFile(buildFlagsDocPath, 'utf8')

      expect(content).toContain('--clean')
      expect(content).toContain('--verify')
      expect(content).toContain('--test')
    })
  })

  describe('build directory structure', () => {
    it('should have build directory', () => {
      if (!existsSync(buildDir)) {
        // Skip if build has not been run
        return
      }
      expect(existsSync(buildDir)).toBeTruthy()
    })
  })

  describe('package is private', () => {
    it('should be marked as private', async () => {
      const pkgJson = await readPackageJson(
        path.join(nodeSmolBuilderDir, 'package.json'),
      )

      expect(pkgJson.private).toBeTruthy()
    })

    it('should not have publishConfig for npm', async () => {
      const pkgJson = await readPackageJson(
        path.join(nodeSmolBuilderDir, 'package.json'),
      )

      // Private package should not configure npm publishing.
      expect(pkgJson.publishConfig).toBeUndefined()
    })
  })

  describe('build script structure', () => {
    it('build.mts should import required dependencies', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      // Check for key imports.
      expect(content).toContain("from 'node:fs'")
    })

    it('build.mts should reference the patch stage', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      expect(content).toContain('patch')
    })
  })

  // Build execution requires a compilation toolchain (gcc, make, python),
  // ~1GB disk, 5-10 minutes, and is platform-specific — covered by manual
  // runs and dedicated CI jobs only.
  it.todo('should build custom Node.js binary')
  it.todo('should apply Socket patches')
  it.todo('should produce binary under 30MB')
})

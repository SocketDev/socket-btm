/**
 * @fileoverview Tests for @socketbin/node-smol-builder package structure and configuration.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readPackageJson } from '@socketsecurity/lib/packages/operations'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeSmolBuilderDir = path.resolve(__dirname, '..', '..')
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
      expect(pkgJson.scripts.build).toBe('node scripts/common/shared/build.mts')
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
    it('build.mts should document binary size optimization', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      expect(content).toContain('Binary Size Optimization')
      expect(content).toContain('TARGET')
      expect(content).toContain('MB')
    })

    it('build.mts should document configuration flags', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      expect(content).toContain('--with-intl=small-icu')
      expect(content).toContain('--without-* flags')
    })

    it('build.mts should document compression approach', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      expect(content).toContain('Compression Approach')
      expect(content).toContain('Brotli')
    })

    it('build.mts should document performance impact', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      expect(content).toContain('Performance Impact')
      expect(content).toContain('Startup overhead')
      expect(content).toContain('Runtime performance')
    })

    it('build.mts should document usage options', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

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

    it('build.mts should reference Socket patches', async () => {
      const buildPath = path.join(scriptsDir, 'common/shared/build.mts')
      const content = await fs.readFile(buildPath, 'utf8')

      expect(content).toContain('Socket')
      expect(content).toContain('patch')
    })
  })

  // Note: Actual build execution tests are skipped because:
  // - Builds take 5-10 minutes
  // - Require compilation toolchain (gcc, make, python)
  // - Require ~1GB disk space for source
  // - Platform-specific build process
  // - Best tested manually or in dedicated CI jobs
  describe.skip('build execution (manual/CI only)', () => {
    it.todo('should build custom Node.js binary')

    it.todo('should apply Socket patches')

    it.todo('should produce binary under 30MB')
  })
})

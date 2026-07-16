/**
 * Manifest Tests for node:smol-manifest.
 *
 * Test cases aligned with socket-sbom-generator lockfile parsing behavior.
 *
 * Gold standard: socket-sbom-generator.
 *
 * @see /Users/<user>/projects/socket-sbom-generator
 *
 * Supported formats:
 * - package.json (npm manifest)
 * - package-lock.json (npm lockfile v1, v2, v3)
 * - yarn.lock (v1, berry)
 * - pnpm-lock.yaml (v5, v6, v9)
 */

import { describe, expect, it } from 'vitest'

import './helpers/primordials-shim.mts'

import {
  detectFormat,
  parse,
  parseLockfile,
  parseManifest,
  supportedFiles,
} from '../additions/source-patched/lib/internal/socketsecurity/manifest.js'

describe('node:smol-manifest', () => {
  describe('detectFormat()', () => {
    it('should detect package.json as npm manifest', () => {
      const format = detectFormat('package.json')
      expect(format.ecosystem).toBe('npm')
      expect(format.type).toBe('manifest')
    })

    it('should detect package-lock.json as npm lockfile', () => {
      const format = detectFormat('package-lock.json')
      expect(format.ecosystem).toBe('npm')
      expect(format.format).toBe('npm')
      expect(format.type).toBe('lockfile')
    })

    it('should detect yarn.lock as yarn lockfile', () => {
      const format = detectFormat('yarn.lock')
      expect(format.ecosystem).toBe('npm')
      expect(format.format).toBe('yarn')
    })

    it('should detect pnpm-lock.yaml as pnpm lockfile', () => {
      const format = detectFormat('pnpm-lock.yaml')
      expect(format.ecosystem).toBe('npm')
      expect(format.format).toBe('pnpm')
    })

    it('should handle path with directory', () => {
      const format = detectFormat('/some/path/to/package.json')
      expect(format.ecosystem).toBe('npm')
    })

    it('should return null for unknown files', () => {
      expect(detectFormat('unknown.txt')).toBeUndefined()
      expect(detectFormat('random.json')).toBeUndefined()
    })
  })

  describe('supportedFiles constant', () => {
    it('should list supported manifests', () => {
      expect(supportedFiles.manifests).toContain('package.json')
    })

    it('should list supported lockfiles', () => {
      expect(supportedFiles.lockfiles).toContain('package-lock.json')
      expect(supportedFiles.lockfiles).toContain('yarn.lock')
      expect(supportedFiles.lockfiles).toContain('pnpm-lock.yaml')
    })
  })

  describe('parseManifest() - package.json', () => {
    it('should parse basic package.json', () => {
      const content = JSON.stringify({
        name: 'test-package',
        version: '1.0.0',
        description: 'A test package',
        dependencies: {
          lodash: '^4.17.21',
        },
      })

      const result = parseManifest(content, 'npm')
      expect(result.type).toBe('manifest')
      expect(result.name).toBe('test-package')
      expect(result.version).toBe('1.0.0')
      expect(result.description).toBe('A test package')
      expect(result.ecosystem).toBe('npm')
    })

    it('should parse dependencies by type', () => {
      const content = JSON.stringify({
        name: 'test',
        dependencies: { lodash: '^4.17.21' },
        devDependencies: { vitest: '^1.0.0' },
        peerDependencies: { react: '^18.0.0' },
        optionalDependencies: { fsevents: '^2.0.0' },
      })

      const result = parseManifest(content, 'npm')

      const prod = result.dependencies.find(d => d.name === 'lodash')
      expect(prod.type).toBe('prod')

      const dev = result.dependencies.find(d => d.name === 'vitest')
      expect(dev.type).toBe('dev')

      const peer = result.dependencies.find(d => d.name === 'react')
      expect(peer.type).toBe('peer')

      const optional = result.dependencies.find(d => d.name === 'fsevents')
      expect(optional.type).toBe('optional')
      expect(optional.optional).toBe(true)
    })

    it('should handle string repository', () => {
      const content = JSON.stringify({
        name: 'test',
        repository: 'https://github.com/user/repo',
      })

      const result = parseManifest(content, 'npm')
      expect(result.repository).toBe('https://github.com/user/repo')
    })

    it('should handle object repository', () => {
      const content = JSON.stringify({
        name: 'test',
        repository: { type: 'git', url: 'https://github.com/user/repo.git' },
      })

      const result = parseManifest(content, 'npm')
      expect(result.repository).toBe('https://github.com/user/repo.git')
    })

    it('should throw on invalid JSON', () => {
      expect(() => parseManifest('invalid json', 'npm')).toThrow(/Invalid JSON/)
    })
  })

  describe('parseLockfile() - package-lock.json v2/v3', () => {
    it('should parse package-lock.json v3 format', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'root', version: '1.0.0' },
          'node_modules/lodash': {
            version: '4.17.21',
            resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
            integrity:
              'sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==',
            license: 'MIT',
          },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.type).toBe('lockfile')
      expect(result.lockVersion).toBe('3')
      expect(result.packages.length).toBe(1)

      const lodash = result.packages[0]
      expect(lodash.name).toBe('lodash')
      expect(lodash.version).toBe('4.17.21')
      expect(lodash.integrity).toContain('sha512-')
      expect(lodash.license).toBe('MIT')
      expect(lodash.isDev).toBe(false)
      expect(lodash.isOptional).toBe(false)
      expect(lodash.isPeer).toBe(false)
    })

    it('should skip root package (empty path)', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'root', version: '1.0.0' },
          'node_modules/express': { version: '4.18.0' },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.packages.length).toBe(1)
      expect(result.packages[0].name).toBe('express')
    })

    it('should detect dev and optional dependencies', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/lodash': { version: '4.17.21' },
          'node_modules/vitest': { version: '1.0.0', dev: true },
          'node_modules/fsevents': { version: '2.0.0', optional: true },
          'node_modules/react': { version: '18.0.0', peer: true },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')

      const lodash = result.packages.find(p => p.name === 'lodash')
      expect(lodash.depType).toBe('prod')
      expect(lodash.isDev).toBe(false)

      const vitest = result.packages.find(p => p.name === 'vitest')
      expect(vitest.depType).toBe('dev')
      expect(vitest.isDev).toBe(true)

      const fsevents = result.packages.find(p => p.name === 'fsevents')
      expect(fsevents.depType).toBe('optional')
      expect(fsevents.isOptional).toBe(true)

      const react = result.packages.find(p => p.name === 'react')
      expect(react.depType).toBe('peer')
      expect(react.isPeer).toBe(true)
    })
  })

  describe('parseLockfile() - package-lock.json v1', () => {
    it('should parse package-lock.json v1 format', () => {
      const content = JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          lodash: {
            version: '4.17.21',
            resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
            integrity: 'sha512-abc123==',
          },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.lockVersion).toBe('1')
      expect(result.packages.length).toBe(1)
      expect(result.packages[0].name).toBe('lodash')
    })

    it('should handle nested dependencies in v1', () => {
      const content = JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          express: {
            version: '4.18.0',
            dependencies: {
              accepts: { version: '1.3.8' },
            },
          },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.packages.length).toBe(2)
    })
  })

  describe('parseLockfile() - yarn.lock v1', () => {
    it('should parse yarn.lock v1 format', () => {
      const content = `# yarn lockfile v1

lodash@^4.17.0:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
  integrity sha512-v2kDEe57==

express@^4.18.0:
  version "4.18.2"
  resolved "https://registry.yarnpkg.com/express/-/express-4.18.2.tgz"
`

      const result = parseLockfile(content, 'npm', 'yarn')
      expect(result.type).toBe('lockfile')
      expect(result.lockVersion).toBe('1')
      expect(result.packages.length).toBe(2)

      const lodash = result.packages.find(p => p.name === 'lodash')
      expect(lodash.version).toBe('4.17.21')
    })

    it('should handle scoped packages in yarn.lock', () => {
      const content = `# yarn lockfile v1

"@babel/core@^7.0.0":
  version "7.23.0"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.23.0.tgz"
`

      const result = parseLockfile(content, 'npm', 'yarn')
      const babel = result.packages.find(p => p.name === '@babel/core')
      expect(babel.version).toBe('7.23.0')
    })
  })

  describe('parseLockfile() - pnpm-lock.yaml v5', () => {
    it('should parse pnpm-lock.yaml v5 format', () => {
      // v5 uses /name/version format
      const content = `lockfileVersion: '5.4'

packages:

  /lodash/4.17.21:
    resolution: {integrity: sha512-abc123==}
    dev: false

  /@babel/core/7.23.0:
    resolution: {integrity: sha512-xyz456==}
    dev: true
`

      const result = parseLockfile(content, 'npm', 'pnpm')
      expect(result.lockVersion).toBe('5')
      expect(result.packages.length).toBe(2)

      const lodash = result.packages.find(p => p.name === 'lodash')
      expect(lodash.version).toBe('4.17.21')
      expect(lodash.depType).toBe('prod')

      const babel = result.packages.find(p => p.name === '@babel/core')
      expect(babel.version).toBe('7.23.0')
      expect(babel.depType).toBe('dev')
    })

    it('should handle peer dependency suffix in v5', () => {
      const content = `lockfileVersion: '5.4'

packages:

  /next/14.0.0_react@18.2.0:
    resolution: {integrity: sha512-abc==}
    dev: false
`

      const result = parseLockfile(content, 'npm', 'pnpm')
      const next = result.packages.find(p => p.name === 'next')
      expect(next.version).toBe('14.0.0')
    })
  })

  describe('parseLockfile() - pnpm-lock.yaml v6', () => {
    it('should parse pnpm-lock.yaml v6 format', () => {
      // v6 uses name@version format for unscoped packages
      // Scoped packages with /@ prefix use v5-style parsing
      const content = `lockfileVersion: '6.0'

packages:

  lodash@4.17.21:
    resolution: {integrity: sha512-abc123==}
    dev: false

  express@4.18.2:
    resolution: {integrity: sha512-xyz456==}
    dev: true
`

      const result = parseLockfile(content, 'npm', 'pnpm')
      expect(result.lockVersion).toBe('6')

      const lodash = result.packages.find(p => p.name === 'lodash')
      expect(lodash.version).toBe('4.17.21')
      expect(lodash.depType).toBe('prod')

      const express = result.packages.find(p => p.name === 'express')
      expect(express.version).toBe('4.18.2')
      expect(express.depType).toBe('dev')
    })

    it('should handle peer dependency suffix in v6/v9', () => {
      const content = `lockfileVersion: '6.0'

packages:

  next@14.0.0(react@18.2.0):
    resolution: {integrity: sha512-abc==}
    dev: false
`

      const result = parseLockfile(content, 'npm', 'pnpm')
      const next = result.packages.find(p => p.name === 'next')
      expect(next.version).toBe('14.0.0')
    })
  })

  describe('parseLockfile() - pnpm-lock.yaml v9 snapshots', () => {
    it('should parse pnpm-lock.yaml v9 with snapshots section', () => {
      // v9 uses snapshots section with name@version format
      const content = `lockfileVersion: '9.0'

snapshots:

  lodash@4.17.21:
    integrity: sha512-abc123==

  typescript@5.3.0:
    integrity: sha512-xyz456==
    dev: true
`

      const result = parseLockfile(content, 'npm', 'pnpm')
      expect(result.lockVersion).toBe('9')

      const lodash = result.packages.find(p => p.name === 'lodash')
      expect(lodash.version).toBe('4.17.21')

      const ts = result.packages.find(p => p.name === 'typescript')
      expect(ts.version).toBe('5.3.0')
      expect(ts.depType).toBe('dev')
    })
  })

  describe('parse() - Auto-detection', () => {
    it('should auto-detect package.json', () => {
      const content = JSON.stringify({ name: 'test', version: '1.0.0' })
      const result = parse('package.json', content)
      expect(result.type).toBe('manifest')
    })

    it('should auto-detect package-lock.json', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/lodash': { version: '4.17.21' } },
      })
      const result = parse('package-lock.json', content)
      expect(result.type).toBe('lockfile')
    })

    it('should auto-detect yarn.lock', () => {
      const content = `# yarn lockfile v1

lodash@^4.0.0:
  version "4.17.21"
`
      const result = parse('yarn.lock', content)
      expect(result.type).toBe('lockfile')
    })

    it('should auto-detect pnpm-lock.yaml', () => {
      const content = `lockfileVersion: '9.0'

snapshots:
  lodash@4.17.21:
    dev: false
`
      const result = parse('pnpm-lock.yaml', content)
      expect(result.type).toBe('lockfile')
    })

    it('should throw for unknown files', () => {
      expect(() => parse('unknown.txt', '')).toThrow(/Unknown file format/)
    })
  })
})

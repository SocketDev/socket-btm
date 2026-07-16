import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * @file Query, edge-case, and regression tests for node:smol-manifest.
 *   Covers getPackage, findPackages, analyzeLockfile, edge cases, git URL
 *   parsing, sdxgen alignment, and fixture regressions.
 *   Split from smol-manifest.test.mts.
 */

import './helpers/primordials-shim.mts'

import {
  analyzeLockfile,
  findPackages,
  getPackage,
  parseLockfile,
  parseManifest,
} from '../additions/source-patched/lib/internal/socketsecurity/manifest.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES_DIR = path.join(__dirname, 'fixtures/sdxgen-bug-regressions')

describe('smol-manifest query and analysis', () => {
  describe('getPackage() - O(1) lookup', () => {
    it('should lookup package by name', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/lodash': { version: '4.17.21' },
          'node_modules/express': { version: '4.18.0' },
        },
      })

      const lockfile = parseLockfile(content, 'npm', 'npm')
      const pkg = getPackage(lockfile, 'lodash')
      expect(pkg.version).toBe('4.17.21')
    })

    it('should return null for non-existent package', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/lodash': { version: '4.17.21' } },
      })

      const lockfile = parseLockfile(content, 'npm', 'npm')
      expect(getPackage(lockfile, 'nonexistent')).toBeUndefined()
    })
  })

  describe('findPackages() - Pattern matching', () => {
    it('should find packages by regex pattern', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/@babel/core': { version: '7.23.0' },
          'node_modules/@babel/preset-env': { version: '7.23.0' },
          'node_modules/lodash': { version: '4.17.21' },
        },
      })

      const lockfile = parseLockfile(content, 'npm', 'npm')
      const babelPkgs = findPackages(lockfile, /^@babel/)
      expect(babelPkgs.length).toBe(2)
    })

    it('should find packages by string pattern', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/lodash': { version: '4.17.21' },
          'node_modules/lodash-es': { version: '4.17.21' },
        },
      })

      const lockfile = parseLockfile(content, 'npm', 'npm')
      const pkgs = findPackages(lockfile, 'lodash')
      expect(pkgs.length).toBe(2)
    })
  })

  describe('analyzeLockfile()', () => {
    it('should return lockfile statistics', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/lodash': { version: '4.17.21' },
          'node_modules/vitest': { version: '1.0.0', dev: true },
          'node_modules/fsevents': { version: '2.0.0', optional: true },
        },
      })

      const lockfile = parseLockfile(content, 'npm', 'npm')
      const stats = analyzeLockfile(lockfile)

      expect(stats.totalPackages).toBe(3)
      expect(stats.prodDeps).toBe(1)
      expect(stats.devDeps).toBe(1)
      expect(stats.optionalDeps).toBe(1)
      expect(stats.byEcosystem.npm).toBe(3)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty dependencies', () => {
      const content = JSON.stringify({
        name: 'test',
        version: '1.0.0',
      })

      const result = parseManifest(content, 'npm')
      expect(result.dependencies).toEqual([])
    })

    it('should handle missing optional fields', () => {
      const content = JSON.stringify({ name: 'test' })

      const result = parseManifest(content, 'npm')
      expect(result.version).toBeUndefined()
      expect(result.description).toBeUndefined()
      expect(result.license).toBeUndefined()
    })

    it('should handle deeply nested node_modules paths', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/a/node_modules/b/node_modules/c': { version: '1.0.0' },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.packages[0].name).toBe('c')
    })

    it('should parse git dependencies (P0.3)', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/custom-lib': {
            version: '1.0.0',
            resolved: 'git+https://github.com/user/repo.git#abc123',
          },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      const pkg = result.packages[0]
      expect(pkg.vcsUrl).toBe('git+https://github.com/user/repo.git')
      expect(pkg.vcsCommit).toBe('abc123')
    })

    it('should handle scoped packages in nested paths', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/@babel/core': { version: '7.23.0' },
          'node_modules/foo/node_modules/@babel/parser': { version: '7.23.0' },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.packages[0].name).toBe('@babel/core')
      expect(result.packages[1].name).toBe('@babel/parser')
    })

    it('should extract dependencies list', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/express': {
            version: '4.18.0',
            dependencies: {
              accepts: '^1.3.8',
              'body-parser': '^1.20.0',
            },
          },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      const express = result.packages[0]
      expect(express.dependencies).toEqual(['accepts', 'body-parser'])
    })
  })

  describe('Git URL Parsing (P0.3)', () => {
    it('should detect git+https URLs', () => {
      const content = JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          'my-lib': {
            version: '1.0.0',
            resolved: 'git+https://github.com/user/repo.git#commit123',
          },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.packages[0].vcsUrl).toBe(
        'git+https://github.com/user/repo.git',
      )
      expect(result.packages[0].vcsCommit).toBe('commit123')
    })

    it('should detect git:// URLs', () => {
      const content = JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          'my-lib': {
            version: '1.0.0',
            resolved: 'git://github.com/user/repo.git#commit456',
          },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.packages[0].vcsUrl).toBe('git://github.com/user/repo.git')
      expect(result.packages[0].vcsCommit).toBe('commit456')
    })

    it('should handle git URLs without commit hash', () => {
      const content = JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          'my-lib': {
            version: '1.0.0',
            resolved: 'git+https://github.com/user/repo.git',
          },
        },
      })

      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.packages[0].vcsUrl).toBe(
        'git+https://github.com/user/repo.git',
      )
      expect(result.packages[0].vcsCommit).toBeUndefined()
    })
  })

  describe('alignment with sdxgen reference parsers', () => {
    it('pnpm v9 importer entries with block-style version do not leak empty version', () => {
      const content = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      lodash:
        specifier: ^4.17.0
        version: 4.17.21
`
      const result = parseLockfile(content, 'npm', 'pnpm')
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const pkg of result.packages) {
        expect(pkg.version).not.toBe('')
      }
    })

    it('pnpm importer scan skips workspace: and file: protocol versions', () => {
      const content = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      ws-dep: workspace:^1.0.0
      file-dep: file:./local.tgz
      real-dep: 1.0.0
`
      const result = parseLockfile(content, 'npm', 'pnpm')
      const names = result.packages.map(p => p.name)
      expect(names).toContain('real-dep')
      expect(names).not.toContain('ws-dep')
      expect(names).not.toContain('file-dep')
    })

    it('yarn dependenciesMeta.<child>.optional does NOT flip parent isOptional', () => {
      const content = `__metadata:
  version: 6

"react@npm:^18.0.0":
  version: 18.0.0
  resolution: "react@npm:18.0.0"
  dependenciesMeta:
    fsevents:
      optional: true
  linkType: hard
`
      const result = parseLockfile(content, 'npm', 'yarn')
      const react = result.packages.find(p => p.name === 'react')
      expect(react.isOptional).toBe(false)
    })

    it('npm v1 aliased installs extract real name + version from npm: prefix', () => {
      const content = JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          'string-width-cjs': {
            version: 'npm:string-width@4.2.3',
            resolved:
              'https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz',
          },
        },
      })
      const result = parseLockfile(content, 'npm', 'npm')
      const sw = result.packages.find(p => p.name === 'string-width')
      expect(sw).toBeDefined()
      expect(sw.version).toBe('4.2.3')
    })

    it('npm v2/v3 workspace entries are named by pkg.name (not path)', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'packages/ui': {
            name: '@my-org/ui',
            version: '0.0.0',
          },
          'node_modules/regular-dep': { version: '1.0.0' },
        },
      })
      const result = parseLockfile(content, 'npm', 'npm')
      const ws = result.packages.find(p => p.name === '@my-org/ui')
      expect(ws).toBeDefined()
      expect(ws.version).toBe('0.0.0')
      const reg = result.packages.find(p => p.name === 'regular-dep')
      expect(reg).toBeDefined()
    })

    it('npm v2/v3 aliased installs prefer pkg.name', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/sw-cjs': {
            name: 'string-width',
            version: '4.2.3',
          },
        },
      })
      const result = parseLockfile(content, 'npm', 'npm')
      expect(result.packages.map(p => p.name)).toEqual(['string-width'])
    })
  })

  describe('sdxgen-bug-regressions fixtures', () => {
    const FIXTURES = [
      { dir: 'fix1-npm-v1-alias' },
      { dir: 'fix2a-npm-v3-workspace-name' },
      { dir: 'fix2b-npm-v3-alias-name' },
      { dir: 'fix3a-pnpm-v9-empty-version' },
      { dir: 'fix3b-pnpm-v9-workspace-file-filter' },
      { dir: 'fix4-yarn-depsmeta-inversion' },
      { dir: 'fix5-pnpm-v9-isdev-derivation' },
      { dir: 'cargo-patch-unused-no-leak' },
    ]

    it('every fixture directory is wired into the table', () => {
      const onDisk = readdirSync(FIXTURES_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .toSorted()
      const inTable = FIXTURES.map(f => f.dir).toSorted()
      expect(onDisk).toEqual(inTable)
    })

    it('every fixture directory contains input.* + expected.json + README.md', () => {
      for (let i = 0, { length } = FIXTURES; i < length; i += 1) {
        const f = FIXTURES[i]
        const dirEntries = readdirSync(path.join(FIXTURES_DIR, f.dir))
        expect(dirEntries.some(e => e.startsWith('input.'))).toBe(true)
        expect(dirEntries).toContain('expected.json')
        expect(dirEntries).toContain('README.md')
        const expected = JSON.parse(
          readFileSync(path.join(FIXTURES_DIR, f.dir, 'expected.json'), 'utf8'),
        )
        expect(expected).toHaveProperty('type', 'lockfile')
        expect(expected).toHaveProperty('packages')
        expect(Array.isArray(expected.packages)).toBe(true)
      }
    })

    for (let i = 0, { length } = FIXTURES; i < length; i += 1) {
      const fixture = FIXTURES[i]
      it.todo(`${fixture.dir}: smol parseLockfile output matches expected.json`)
    }
  })
})

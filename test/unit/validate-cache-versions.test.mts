/**
 * @file Unit tests for the cache-version cascade rules. Regression coverage
 *   for the gap where `packages/*\/upstream/` submodule bumps were invisible
 *   to scripts/repo/validate-cache-versions.mts's check gate: every lockstep
 *   version-pin row backed by a real submodule that feeds a
 *   `.github/cache-versions.json` key must have a matching CASCADE_RULES
 *   entry, and a sample changed path under each covered submodule must
 *   resolve to its documented cache keys.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { CASCADE_RULES } from '../../scripts/repo/validate-cache-versions.mts'
import { CONFIG_REPO_DIR } from '../../scripts/fleet/paths.mts'

interface UpstreamEntry {
  repo: string
  submodule: string
}

interface LockstepManifest {
  upstreams: Record<string, UpstreamEntry>
}

const RULES = CASCADE_RULES as Record<string, readonly string[]>

function readLockstepManifest(): LockstepManifest {
  const manifestPath = path.join(CONFIG_REPO_DIR, 'lockstep.json')
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as LockstepManifest
}

function cascadeKeysFor(changedFile: string): string[] {
  const hit = new Set<string>()
  for (const [pathPrefix, packages] of Object.entries(RULES)) {
    if (changedFile.startsWith(pathPrefix)) {
      for (const pkg of packages) {
        hit.add(pkg)
      }
    }
  }
  return [...hit].toSorted()
}

// Every upstream whose submodule bump changes a compiled artifact tracked by
// a .github/cache-versions.json key. Test-fixture-only upstreams (`wpt`) and
// upstreams with no version-pin row of their own (`temporal-rs`, referenced
// only by file-fork rows) are intentionally excluded — there is no cache key
// to invalidate for either.
const EXPECTED_CASCADE_UPSTREAMS = [
  'boringssl',
  'cjson',
  'curl',
  'dawn',
  'libdeflate',
  'libqrencode',
  'liburing',
  'lief',
  'ls-qpack',
  'lsquic',
  'mbedtls',
  'md4c',
  'node',
  'onnxruntime',
  'opentui',
  'postgres',
  'semver',
  'tree-sitter',
  'usockets',
  'uwebsockets',
  'yoga',
  'zstd',
]

describe('CASCADE_RULES upstream submodule coverage', () => {
  const manifest = readLockstepManifest()

  it('has an upstreams entry in lockstep.json for every expected key', () => {
    for (
      let i = 0, { length } = EXPECTED_CASCADE_UPSTREAMS;
      i < length;
      i += 1
    ) {
      const upstreamId = EXPECTED_CASCADE_UPSTREAMS[i]!
      expect(
        manifest.upstreams[upstreamId],
        `missing upstreams.${upstreamId} in .config/repo/lockstep.json`,
      ).toBeDefined()
    }
  })

  it('has a CASCADE_RULES entry for every lockstep upstream that feeds a build cache', () => {
    const missing: string[] = []
    for (
      let i = 0, { length } = EXPECTED_CASCADE_UPSTREAMS;
      i < length;
      i += 1
    ) {
      const upstreamId = EXPECTED_CASCADE_UPSTREAMS[i]!
      const upstream = manifest.upstreams[upstreamId]
      if (!upstream) {
        continue
      }
      const prefix = `${upstream.submodule}/`
      if (!(prefix in RULES)) {
        missing.push(`${upstreamId} (${prefix})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('resolves each covered submodule path to a non-empty cache-key list', () => {
    for (
      let i = 0, { length } = EXPECTED_CASCADE_UPSTREAMS;
      i < length;
      i += 1
    ) {
      const upstreamId = EXPECTED_CASCADE_UPSTREAMS[i]!
      const upstream = manifest.upstreams[upstreamId]
      if (!upstream) {
        continue
      }
      const prefix = `${upstream.submodule}/`
      const keys = RULES[prefix]
      expect(Array.isArray(keys) && keys.length > 0).toBe(true)
    }
  })
})

describe('CASCADE_RULES sample path resolution', () => {
  it('maps a node submodule file to node-smol', () => {
    expect(
      cascadeKeysFor('packages/node-smol-builder/upstream/node/src/node.cc'),
    ).toEqual(['node-smol'])
  })

  it('maps a curl submodule file to curl + node-smol + stubs', () => {
    expect(
      cascadeKeysFor('packages/curl-builder/upstream/curl/lib/easy.c'),
    ).toEqual(['curl', 'node-smol', 'stubs'])
  })

  it('maps a mbedtls submodule file to curl + node-smol + stubs', () => {
    expect(
      cascadeKeysFor(
        'packages/curl-builder/upstream/mbedtls/library/ssl_tls.c',
      ),
    ).toEqual(['curl', 'node-smol', 'stubs'])
  })

  it('maps a boringssl submodule file to boringssl only', () => {
    expect(
      cascadeKeysFor(
        'packages/boringssl-builder/upstream/boringssl/include/openssl/ssl.h',
      ),
    ).toEqual(['boringssl'])
  })

  it('maps a postgres submodule file to libpq only', () => {
    expect(
      cascadeKeysFor('packages/libpq-builder/upstream/postgres/src/bin/psql'),
    ).toEqual(['libpq'])
  })

  it('maps a zstd submodule file to the full binject/binpress/node-smol chain', () => {
    expect(
      cascadeKeysFor('packages/bin-infra/upstream/zstd/lib/zstd.c'),
    ).toEqual(['binflate', 'binject', 'binpress', 'node-smol', 'stubs'])
  })

  it('maps an opentui submodule file to opentui + node-smol', () => {
    expect(
      cascadeKeysFor(
        'packages/opentui-builder/upstream/opentui/packages/core/src/lib/border.ts',
      ),
    ).toEqual(['node-smol', 'opentui'])
  })

  it('does not cascade an unrelated path', () => {
    expect(cascadeKeysFor('docs/agents.md/repo/architecture.md')).toEqual([])
  })
})

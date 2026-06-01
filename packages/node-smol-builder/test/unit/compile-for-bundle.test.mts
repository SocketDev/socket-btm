/**
 * @fileoverview Unit tests for the cached-compile orchestrator's pure logic.
 *
 * The actual build is a 30–60 min native compile (not run here); these tests
 * cover the cache-key contract that makes per-bundle builds dedup correctly:
 * identical flag sets → identical key (cache hit, build once); any change →
 * different key (rebuild). End-to-end detect→plan is exercised via --dry-run in
 * the integration/manual path.
 */

import { computeCacheKey } from '../../scripts/compile-for-bundle.mts'

describe('computeCacheKey', () => {
  const base = {
    configureFlags: ['--without-smol-quic', '--without-smol-tui'],
    platformArch: 'darwin-arm64',
    buildMode: 'prod',
  }

  it('is stable for identical inputs', () => {
    expect(computeCacheKey(base)).toBe(computeCacheKey({ ...base }))
  })

  it('is order-independent in the flag list (sorted internally)', () => {
    const reordered = {
      ...base,
      configureFlags: ['--without-smol-tui', '--without-smol-quic'],
    }
    expect(computeCacheKey(reordered)).toBe(computeCacheKey(base))
  })

  it('changes when a flag is added (forces rebuild)', () => {
    const more = {
      ...base,
      configureFlags: [...base.configureFlags, '--without-sqlite'],
    }
    expect(computeCacheKey(more)).not.toBe(computeCacheKey(base))
  })

  it('changes when platform differs (separate cache per platform)', () => {
    expect(computeCacheKey({ ...base, platformArch: 'linux-x64' })).not.toBe(
      computeCacheKey(base),
    )
  })

  it('changes when build mode differs (dev vs prod)', () => {
    expect(computeCacheKey({ ...base, buildMode: 'dev' })).not.toBe(
      computeCacheKey(base),
    )
  })

  it('returns a short hex digest', () => {
    expect(computeCacheKey(base)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('two bundles with the same feature set share a key (dedup)', () => {
    // sfw-free and sfw-registry both "minimal" → same flags → one build.
    const flagsA = ['--without-smol-quic', '--without-smol-ffi', '--without-sqlite']
    const flagsB = ['--without-sqlite', '--without-smol-quic', '--without-smol-ffi']
    expect(
      computeCacheKey({ ...base, configureFlags: flagsA }),
    ).toBe(computeCacheKey({ ...base, configureFlags: flagsB }))
  })
})

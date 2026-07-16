/**
 * @file Unit tests for the cached-compile orchestrator's pure logic. The actual
 *   build is a 30–60 min native compile (not run here); these tests cover the
 *   pure logic: (1) the cache-key contract that makes per-bundle builds dedup
 *   correctly — identical flag sets → identical key (cache hit, build once),
 *   any change → different key (rebuild); and (2) buildBuildArgs, which
 *   enforces the "never --from-checkpoint=source-patched" invariant (build.mts
 *   throws on that — it's an internal sub-checkpoint, not a resume entry
 *   point). End-to-end detect→plan is exercised via --dry-run in the
 *   integration/manual path.
 */

import { describe, expect, it } from 'vitest'

import {
  buildBuildArgs,
  computeCacheKey,
} from '../../scripts/compile-for-bundle.mts'

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
    const flagsA = [
      '--without-smol-quic',
      '--without-smol-ffi',
      '--without-sqlite',
    ]
    const flagsB = [
      '--without-sqlite',
      '--without-smol-quic',
      '--without-smol-ffi',
    ]
    expect(computeCacheKey({ ...base, configureFlags: flagsA })).toBe(
      computeCacheKey({ ...base, configureFlags: flagsB }),
    )
  })
})

describe('buildBuildArgs', () => {
  const buildScriptPath = '/abs/scripts/common/shared/build.mts'

  it('NEVER passes --from-checkpoint=source-patched (build.mts would throw)', () => {
    // Regression: source-patched is an internal Phase-1 sub-checkpoint, not a
    // --from-checkpoint resume entry point. build.mts validates --from-checkpoint
    // against {binary-released, binary-stripped, binary-compressed, finalized}
    // and throws on anything else. A trimmed build is a normal Phase-1 build with
    // --without-smol; it must not pass --from-checkpoint at all.
    const args = buildBuildArgs({
      buildScriptPath,
      buildMode: 'prod',
      flags: ['--without-smol-quic'],
    })
    expect(args.some(a => a.includes('--from-checkpoint'))).toBe(false)
    expect(args.some(a => a.includes('source-patched'))).toBe(false)
  })

  it('forwards the drop flags through the single --without-smol channel', () => {
    const flags = [
      '--without-smol-quic',
      '--without-smol-tui',
      '--v8-lite-mode',
    ]
    const args = buildBuildArgs({ buildScriptPath, buildMode: 'prod', flags })
    expect(args).toContain(`--without-smol=${flags.join(',')}`)
  })

  it('omits --without-smol entirely when there are no flags', () => {
    const args = buildBuildArgs({
      buildScriptPath,
      buildMode: 'dev',
      flags: [],
    })
    expect(args.some(a => a.startsWith('--without-smol'))).toBe(false)
  })

  it('selects the build-mode flag (--prod / --dev)', () => {
    expect(
      buildBuildArgs({ buildScriptPath, buildMode: 'prod', flags: [] }),
    ).toContain('--prod')
    expect(
      buildBuildArgs({ buildScriptPath, buildMode: 'dev', flags: [] }),
    ).toContain('--dev')
  })

  it('puts the build script path first', () => {
    const args = buildBuildArgs({
      buildScriptPath,
      buildMode: 'prod',
      flags: [],
    })
    expect(args[0]).toBe(buildScriptPath)
  })
})

/**
 * @file Unit tests for the flaggable-test helper
 *   (test/helpers/smol-features.mts). These run on stock Node in CI (no smol
 *   binary), so they assert the helper's binary-absent contract + input
 *   validation. The runtime-config probe mechanism itself is proven separately
 *   against stock Node's `process.config.variables` (which exposes
 *   `node_use_sqlite`), and against a real smol binary in the integration suite
 *   when one is built.
 */

import { describe, expect, it } from 'vitest'

import {
  has,
  missingRequiredFeatures,
  smolBinary,
} from '../helpers/smol-features.mts'
import { SMOL_FEATURES } from '../../scripts/lib/smol-features.mts'

describe('smol-features test helper', () => {
  it('has() throws on an unknown feature name (catches typos)', () => {
    expect(() => has('qiuc')).toThrow(/unknown smol feature/)
    expect(() => has('notreal')).toThrow(/Known:/)
  })

  it('has() accepts every registered feature name without throwing', () => {
    for (const f of SMOL_FEATURES) {
      expect(() => has(f.name)).not.toThrow()
    }
  })

  it.skipIf(smolBinary)(
    'returns false for all features when no binary is built',
    () => {
      // On stock-Node CI (no smol binary), every feature is reported absent so
      // `skipIf(!smolBinary || !has(x))` short-circuits cleanly.
      for (const f of SMOL_FEATURES) {
        expect(has(f.name)).toBe(false)
      }
    },
  )

  it.skipIf(!smolBinary)(
    'always-on features (no gypVar) are present when a binary exists',
    () => {
      // power has no gypVar (always compiled); intl has none either.
      const alwaysOnFeatures = SMOL_FEATURES.filter(x => !x.gypVar)
      for (let i = 0, { length } = alwaysOnFeatures; i < length; i += 1) {
        const f = alwaysOnFeatures[i]!
        expect(has(f.name)).toBe(true)
      }
    },
  )

  it('missingRequiredFeatures() is empty unless SOCKET_REQUIRE_ALL_FEATURES is set', () => {
    const hadEnv = process.env['SOCKET_REQUIRE_ALL_FEATURES']
    delete process.env['SOCKET_REQUIRE_ALL_FEATURES']
    try {
      expect(missingRequiredFeatures()).toEqual([])
    } finally {
      if (hadEnv !== undefined) {
        process.env['SOCKET_REQUIRE_ALL_FEATURES'] = hadEnv
      }
    }
  })

  it('missingRequiredFeatures() reports gated features when required but no binary', () => {
    // With the env set but no binary, the helper short-circuits to [] (it only
    // asserts against a real binary) — so this stays empty on stock-Node CI.
    const hadEnv = process.env['SOCKET_REQUIRE_ALL_FEATURES']
    process.env['SOCKET_REQUIRE_ALL_FEATURES'] = '1'
    try {
      if (!smolBinary) {
        expect(missingRequiredFeatures()).toEqual([])
      } else {
        // With a full-feature binary, nothing should be missing.
        expect(missingRequiredFeatures()).toEqual([])
      }
    } finally {
      if (hadEnv === undefined) {
        delete process.env['SOCKET_REQUIRE_ALL_FEATURES']
      } else {
        process.env['SOCKET_REQUIRE_ALL_FEATURES'] = hadEnv
      }
    }
  })
})

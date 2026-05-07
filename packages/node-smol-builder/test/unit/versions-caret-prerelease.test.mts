/**
 * Tests for caret-range + prerelease interaction in versions.js.
 *
 * Gold standard: npm `node-semver` v7.x satisfies() behavior.
 *
 * These tests pin down the three subtle prerelease rules in npm semver:
 *
 * 1. Prereleases are only allowed into a range when some comparator in
 *    that range also carries a prerelease on the SAME [major, minor,
 *    patch] tuple. i.e. `^1.2.3-alpha.1` can match `1.2.3-alpha.2` but
 *    `^1.2.3` cannot match `1.2.4-beta.0`.
 *
 * 2. When the range is `^X.Y.Z-pre` and the candidate is `X.Y.Z-different
 *    -pre`, ordering follows prerelease identifier ordering (alpha <
 *    beta < rc, numeric < alphanumeric, etc.).
 *
 * 3. For caret, `^0.0.3-alpha.1` only accepts prereleases on 0.0.3 that
 *    sort >= alpha.1, because ^0.0.Z pins to exact patch.
 */

import { describe, expect, it } from 'vitest'

import {
  satisfies,
} from '../../additions/source-patched/lib/internal/socketsecurity/versions.js'

describe('versions.js satisfies() — caret + prerelease', () => {
  describe('caret with prerelease on same tuple', () => {
    it('^1.2.3-alpha.1 matches 1.2.3-alpha.1', () => {
      expect(satisfies('1.2.3-alpha.1', '^1.2.3-alpha.1')).toBe(true)
    })

    it('^1.2.3-alpha.1 matches 1.2.3-alpha.2 (later prerelease on same tuple)', () => {
      expect(satisfies('1.2.3-alpha.2', '^1.2.3-alpha.1')).toBe(true)
    })

    it('^1.2.3-alpha.1 matches 1.2.3-beta.0 (beta > alpha on same tuple)', () => {
      expect(satisfies('1.2.3-beta.0', '^1.2.3-alpha.1')).toBe(true)
    })

    it('^1.2.3-alpha.2 rejects 1.2.3-alpha.1 (earlier prerelease)', () => {
      expect(satisfies('1.2.3-alpha.1', '^1.2.3-alpha.2')).toBe(false)
    })

    it('^1.2.3-alpha.1 matches stable 1.2.3 (release > prerelease)', () => {
      expect(satisfies('1.2.3', '^1.2.3-alpha.1')).toBe(true)
    })

    it('^1.2.3-alpha.1 matches 1.2.4 (bumped patch within caret range)', () => {
      expect(satisfies('1.2.4', '^1.2.3-alpha.1')).toBe(true)
    })
  })

  describe('caret without prerelease rejects prerelease candidates', () => {
    it('^1.2.3 rejects 1.2.4-beta.0 (no prerelease on caret, prerelease on candidate)', () => {
      expect(satisfies('1.2.4-beta.0', '^1.2.3')).toBe(false)
    })

    it('^1.2.3 rejects 1.3.0-beta.0', () => {
      expect(satisfies('1.3.0-beta.0', '^1.2.3')).toBe(false)
    })
  })

  describe('caret with prerelease on different tuple', () => {
    it('^1.2.3-alpha.1 rejects 1.2.4-alpha.1 (different patch tuple)', () => {
      expect(satisfies('1.2.4-alpha.1', '^1.2.3-alpha.1')).toBe(false)
    })

    it('^1.2.3-alpha.1 rejects 1.3.0-alpha.1 (different minor tuple)', () => {
      expect(satisfies('1.3.0-alpha.1', '^1.2.3-alpha.1')).toBe(false)
    })
  })

  describe('caret ^0.0.Z with prerelease', () => {
    it('^0.0.3-alpha.1 matches 0.0.3-alpha.1', () => {
      expect(satisfies('0.0.3-alpha.1', '^0.0.3-alpha.1')).toBe(true)
    })

    it('^0.0.3-alpha.1 matches 0.0.3-alpha.2', () => {
      expect(satisfies('0.0.3-alpha.2', '^0.0.3-alpha.1')).toBe(true)
    })

    it('^0.0.3-alpha.1 matches stable 0.0.3 (release > prerelease on same tuple)', () => {
      expect(satisfies('0.0.3', '^0.0.3-alpha.1')).toBe(true)
    })

    it('^0.0.3-alpha.1 rejects 0.0.4 — caret on 0.0.Z pins exact patch', () => {
      expect(satisfies('0.0.4', '^0.0.3-alpha.1')).toBe(false)
    })

    it('^0.0.3-alpha.1 rejects 0.0.4-alpha.1 — different patch tuple', () => {
      expect(satisfies('0.0.4-alpha.1', '^0.0.3-alpha.1')).toBe(false)
    })
  })

  describe('caret ^0.Y.Z with prerelease (Y > 0)', () => {
    it('^0.2.3-alpha.1 matches 0.2.3-alpha.1', () => {
      expect(satisfies('0.2.3-alpha.1', '^0.2.3-alpha.1')).toBe(true)
    })

    it('^0.2.3-alpha.1 matches 0.2.4 (patch bump within 0.2.*)', () => {
      expect(satisfies('0.2.4', '^0.2.3-alpha.1')).toBe(true)
    })

    it('^0.2.3-alpha.1 rejects 0.3.0 — caret on 0.Y.Z pins exact minor', () => {
      expect(satisfies('0.3.0', '^0.2.3-alpha.1')).toBe(false)
    })

    it('^0.2.3-alpha.1 rejects 0.2.4-alpha.1 — different patch tuple has prerelease', () => {
      expect(satisfies('0.2.4-alpha.1', '^0.2.3-alpha.1')).toBe(false)
    })
  })
})

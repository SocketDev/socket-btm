/**
 * Tests for fleet soak-policy library. Pure functions; every `now` is
 * passed in so test runs don't drift over wall-clock time.
 */

import { describe, expect, it } from 'vitest'

import {
  checkSoak,
  formatAnnotation,
  parseAnnotation,
  SOAK_DAYS,
} from '../lib/soak-policy.mts'

const FROZEN_NOW = new Date('2026-05-28T12:00:00.000Z')

describe('SOAK_DAYS', () => {
  it('mirrors the pnpm-workspace.yaml minimumReleaseAge floor', () => {
    expect(SOAK_DAYS).toBe(7)
  })
})

describe('checkSoak', () => {
  it('reports unsoaked for a pin published today', () => {
    const result = checkSoak('2026-05-28', FROZEN_NOW)
    expect(result.soaked).toBe(false)
    expect(result.daysOld).toBe(0)
    expect(result.removable).toBe('2026-06-04')
  })
  it('reports unsoaked mid-window', () => {
    const result = checkSoak('2026-05-24', FROZEN_NOW)
    expect(result.soaked).toBe(false)
    expect(result.daysOld).toBe(4)
    expect(result.removable).toBe('2026-05-31')
  })
  it('reports soaked at the boundary', () => {
    const result = checkSoak('2026-05-21', FROZEN_NOW)
    expect(result.soaked).toBe(true)
    expect(result.daysOld).toBe(7)
    expect(result.removable).toBe('2026-05-28')
  })
  it('reports soaked long after the boundary', () => {
    const result = checkSoak('2025-01-01', FROZEN_NOW)
    expect(result.soaked).toBe(true)
    expect(result.daysOld).toBeGreaterThan(SOAK_DAYS)
  })
  it('returns soaked=false + undefined removable on malformed input', () => {
    const result = checkSoak('garbage', FROZEN_NOW)
    expect(result.soaked).toBe(false)
    expect(result.removable).toBeUndefined()
  })
})

describe('parseAnnotation', () => {
  it('parses the canonical shape with `#` marker', () => {
    expect(
      parseAnnotation('# published: 2026-05-21 | removable: 2026-05-28'),
    ).toEqual({
      published: '2026-05-21',
      removable: '2026-05-28',
    })
  })
  it('parses with `//` marker', () => {
    expect(
      parseAnnotation('// published: 2026-05-21 | removable: 2026-05-28'),
    ).toEqual({
      published: '2026-05-21',
      removable: '2026-05-28',
    })
  })
  it('tolerates indentation', () => {
    expect(
      parseAnnotation('    # published: 2026-05-21 | removable: 2026-05-28'),
    ).toEqual({
      published: '2026-05-21',
      removable: '2026-05-28',
    })
  })
  it('recomputes removable from published so a corrupted annotation cannot lengthen soak', () => {
    expect(
      parseAnnotation('# published: 2026-05-21 | removable: 2099-12-31'),
    ).toEqual({ published: '2026-05-21', removable: '2026-05-28' })
  })
  it('returns undefined when the annotation is absent or malformed', () => {
    expect(parseAnnotation('just a regular comment')).toBeUndefined()
    expect(
      parseAnnotation('# published: not-a-date | removable: also-bad'),
    ).toBeUndefined()
    expect(parseAnnotation('')).toBeUndefined()
    expect(parseAnnotation(undefined)).toBeUndefined()
  })
})

describe('formatAnnotation', () => {
  it('emits the canonical shape with `#` by default', () => {
    expect(formatAnnotation('2026-05-21')).toBe(
      '# published: 2026-05-21 | removable: 2026-05-28',
    )
  })
  it('respects the marker arg', () => {
    expect(formatAnnotation('2026-05-21', '//')).toBe(
      '// published: 2026-05-21 | removable: 2026-05-28',
    )
  })
  it('returns undefined for malformed dates', () => {
    expect(formatAnnotation('garbage')).toBeUndefined()
  })
})

describe('round-trip parse/format', () => {
  it('parseAnnotation(formatAnnotation(x)) recovers published + removable', () => {
    expect(parseAnnotation(formatAnnotation('2026-05-21'))).toEqual({
      published: '2026-05-21',
      removable: '2026-05-28',
    })
  })
})

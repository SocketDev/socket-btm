/**
 * Tests for fleet soak-policy library.
 *
 * The library is pure (no I/O, no logger). Each function gets a tight test
 * with date math that doesn't drift on test re-run — every `now` is
 * passed in explicitly.
 */

import { describe, expect, it } from 'vitest'

import {
  ANNOTATION_RE,
  SOAK_DAYS,
  SOAK_MS,
  checkSoak,
  computeRemovable,
  formatAnnotation,
  formatIsoDate,
  parseAnnotation,
  parseIsoDate,
} from '../lib/soak-policy.mts'

describe('SOAK_DAYS', () => {
  it('mirrors the pnpm-workspace.yaml minimumReleaseAge floor', () => {
    // pnpm-workspace.yaml uses 10080 minutes = 7 days. The TS constant
    // expresses the same floor in days.
    expect(SOAK_DAYS).toBe(7)
    // SOAK_MS is derived; do not duplicate.
    expect(SOAK_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})

describe('parseIsoDate', () => {
  it('parses a valid YYYY-MM-DD string into UTC midnight', () => {
    const date = parseIsoDate('2026-05-28')
    expect(date).not.toBeNull()
    expect(date.toISOString()).toBe('2026-05-28T00:00:00.000Z')
  })
  it('rejects non-ISO inputs', () => {
    expect(parseIsoDate('2026/05/28')).toBeNull()
    expect(parseIsoDate('2026-5-28')).toBeNull()
    expect(parseIsoDate('not a date')).toBeNull()
    expect(parseIsoDate('')).toBeNull()
    expect(parseIsoDate(null)).toBeNull()
    expect(parseIsoDate(undefined)).toBeNull()
  })
})

describe('formatIsoDate', () => {
  it('round-trips with parseIsoDate', () => {
    const date = parseIsoDate('2026-01-15')
    expect(formatIsoDate(date)).toBe('2026-01-15')
  })
  it('returns null for invalid Date objects', () => {
    expect(formatIsoDate(new Date('not a date'))).toBeNull()
    expect(formatIsoDate(null)).toBeNull()
    expect(formatIsoDate('2026-01-15')).toBeNull()
  })
})

describe('computeRemovable', () => {
  it('adds exactly SOAK_DAYS to the published date', () => {
    const removable = computeRemovable('2026-05-21')
    expect(formatIsoDate(removable)).toBe('2026-05-28')
  })
  it('returns null on malformed input', () => {
    expect(computeRemovable('garbage')).toBeNull()
  })
})

describe('checkSoak', () => {
  const FROZEN_NOW = new Date('2026-05-28T12:00:00.000Z')

  it('reports an unsoaked pin published today', () => {
    const result = checkSoak({ published: '2026-05-28', now: FROZEN_NOW })
    expect(result.soaked).toBe(false)
    expect(result.daysOld).toBe(0)
    expect(result.removable).toBe('2026-06-04')
  })
  it('reports an unsoaked pin published mid-window', () => {
    const result = checkSoak({ published: '2026-05-24', now: FROZEN_NOW })
    expect(result.soaked).toBe(false)
    expect(result.daysOld).toBe(4)
    expect(result.removable).toBe('2026-05-31')
  })
  it('reports a soaked pin exactly at the boundary', () => {
    const result = checkSoak({ published: '2026-05-21', now: FROZEN_NOW })
    expect(result.soaked).toBe(true)
    expect(result.daysOld).toBe(7)
    expect(result.removable).toBe('2026-05-28')
  })
  it('reports a soaked pin long past the boundary', () => {
    const result = checkSoak({ published: '2025-01-01', now: FROZEN_NOW })
    expect(result.soaked).toBe(true)
    expect(result.daysOld).toBeGreaterThan(SOAK_DAYS)
  })
  it('returns soaked=false for malformed dates', () => {
    const result = checkSoak({ published: 'garbage', now: FROZEN_NOW })
    expect(result.soaked).toBe(false)
    expect(result.removable).toBeNull()
  })
})

describe('parseAnnotation', () => {
  it('parses the canonical shape with `#` marker', () => {
    const result = parseAnnotation('# published: 2026-05-21 | removable: 2026-05-28')
    expect(result).toEqual({ published: '2026-05-21', removable: '2026-05-28' })
  })
  it('parses with `//` marker (TS / JS source comments)', () => {
    const result = parseAnnotation('// published: 2026-05-21 | removable: 2026-05-28')
    expect(result).toEqual({ published: '2026-05-21', removable: '2026-05-28' })
  })
  it('tolerates indentation', () => {
    const result = parseAnnotation('    # published: 2026-05-21 | removable: 2026-05-28')
    expect(result).toEqual({ published: '2026-05-21', removable: '2026-05-28' })
  })
  it('recomputes `removable` from `published` (corrupted annotations cant lengthen soak)', () => {
    // If a maliciously-edited annotation tries to push `removable` further
    // into the future, parseAnnotation recomputes from `published` so the
    // soak floor is always preserved.
    const result = parseAnnotation('# published: 2026-05-21 | removable: 2099-12-31')
    expect(result.removable).toBe('2026-05-28')
  })
  it('returns null when the annotation is absent', () => {
    expect(parseAnnotation('just a regular comment')).toBeNull()
    expect(parseAnnotation('# published: not-a-date | removable: also-bad')).toBeNull()
    expect(parseAnnotation('')).toBeNull()
    expect(parseAnnotation(null)).toBeNull()
  })
})

describe('formatAnnotation', () => {
  it('emits the canonical shape with `#` by default', () => {
    expect(formatAnnotation('2026-05-21')).toBe(
      '# published: 2026-05-21 | removable: 2026-05-28',
    )
  })
  it('respects the marker option', () => {
    expect(formatAnnotation('2026-05-21', { marker: '//' })).toBe(
      '// published: 2026-05-21 | removable: 2026-05-28',
    )
  })
  it('returns null for malformed dates', () => {
    expect(formatAnnotation('garbage')).toBeNull()
  })
})

describe('round-trip parse/format', () => {
  it('parseAnnotation(formatAnnotation(x)) === { published: x, removable: x+SOAK }', () => {
    const formatted = formatAnnotation('2026-05-21')
    const parsed = parseAnnotation(formatted)
    expect(parsed).toEqual({ published: '2026-05-21', removable: '2026-05-28' })
  })
})

describe('ANNOTATION_RE export', () => {
  it('is exported for cross-surface auditors to share', () => {
    expect(ANNOTATION_RE).toBeInstanceOf(RegExp)
    expect('# published: 2026-05-21 | removable: 2026-05-28').toMatch(
      ANNOTATION_RE,
    )
  })
})

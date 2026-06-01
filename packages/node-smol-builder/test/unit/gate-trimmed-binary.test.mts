/**
 * @fileoverview Unit tests for the fail-closed gate's pure probe logic.
 *
 * checkBinaryFeatures takes an injected `probe` so the fail-closed semantics are
 * tested without a real binary: a dropped feature that's still present FAILS, a
 * kept feature that's missing FAILS, matches pass. The full gate (inject + app
 * suite) needs a real trimmed binary and is exercised in CI once one is built.
 */

import { checkBinaryFeatures } from '../../scripts/gate-trimmed-binary.mts'

const BIN = '/fake/trimmed/node'

// A probe driven by a fixed set of "present" specifiers.
function probeFrom(present: Set<string>) {
  return (_binary: string, specifier: string) => present.has(specifier)
}

describe('checkBinaryFeatures', () => {
  it('passes when dropped features are absent and kept features are present', () => {
    // quic dropped (absent), sqlite kept (present).
    const present = new Set(['node:sqlite'])
    const findings = checkBinaryFeatures(
      BIN,
      [
        { __proto__: null, feature: 'quic', expectDropped: true },
        { __proto__: null, feature: 'sqlite', expectDropped: false },
      ],
      probeFrom(present),
    )
    expect(findings.every(f => f.ok)).toBe(true)
  })

  it('FAILS when a feature marked dropped is still present (gate bug)', () => {
    // quic was supposed to be dropped but the binding still resolves.
    const present = new Set(['node:smol-quic'])
    const findings = checkBinaryFeatures(
      BIN,
      [{ __proto__: null, feature: 'quic', expectDropped: true }],
      probeFrom(present),
    )
    expect(findings[0]!.ok).toBe(false)
    expect(findings[0]!.expectedPresent).toBe(false)
    expect(findings[0]!.actualPresent).toBe(true)
  })

  it('FAILS when a kept feature is missing (over-trimming)', () => {
    // sqlite kept but absent → a flag dropped more than intended.
    const findings = checkBinaryFeatures(
      BIN,
      [{ __proto__: null, feature: 'sqlite', expectDropped: false }],
      probeFrom(new Set()),
    )
    expect(findings[0]!.ok).toBe(false)
    expect(findings[0]!.expectedPresent).toBe(true)
    expect(findings[0]!.actualPresent).toBe(false)
  })

  it('skips features with no importable specifier (intl/temporal)', () => {
    const findings = checkBinaryFeatures(
      BIN,
      [
        { __proto__: null, feature: 'intl', expectDropped: false },
        { __proto__: null, feature: 'temporal', expectDropped: false },
      ],
      probeFrom(new Set()),
    )
    // Neither has a node: specifier → no probe emitted.
    expect(findings).toEqual([])
  })

  it('reports one finding per probeable feature', () => {
    const findings = checkBinaryFeatures(
      BIN,
      [
        { __proto__: null, feature: 'quic', expectDropped: true },
        { __proto__: null, feature: 'tui', expectDropped: true },
        { __proto__: null, feature: 'ffi', expectDropped: false },
      ],
      probeFrom(new Set(['node:smol-ffi'])),
    )
    expect(findings).toHaveLength(3)
    // quic+tui absent (dropped, ok), ffi present (kept, ok).
    expect(findings.every(f => f.ok)).toBe(true)
  })
})

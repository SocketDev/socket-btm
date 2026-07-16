import type { SmolFeature } from './lib/smol-features.mts'
import type { FeatureVerdict, ScanResult } from './detect-bundle-features.mts'

export function decideFeature(
  f: SmolFeature,
  acc: ScanResult,
  sets: { keepSet: Set<string>; dropSet: Set<string> },
): FeatureVerdict {
  const { keepSet, dropSet } = sets
  const hasString = acc.stringHits.has(f.name)
  const hasMember = acc.memberHits.has(f.name)
  const guarded = acc.guardedByIsBuiltin.has(f.name)
  const used = hasString || hasMember

  // Explicit overrides win.
  if (keepSet.has(f.name)) {
    return {
      __proto__: null,
      use: used ? (guarded ? 'soft' : 'hard') : 'none',
      drop: false,
      reason: 'kept by package.json smol.keep override',
    }
  }
  if (dropSet.has(f.name)) {
    return {
      __proto__: null,
      use: used ? (guarded ? 'soft' : 'hard') : 'none',
      drop: true,
      reason: 'dropped by package.json smol.drop override',
    }
  }

  // Never-auto-drop policies.
  if (f.policy === 'always' || f.policy === 'keep-unless-explicit') {
    return {
      __proto__: null,
      use: used ? 'hard' : 'none',
      drop: false,
      reason:
        f.policy === 'always'
          ? 'core runtime — never gated'
          : 'keep-unless-explicit policy (deep coupling); override with smol.drop',
    }
  }

  if (used) {
    if (guarded || f.policy === 'soft') {
      const sig = acc.stringHits.get(f.name) ?? acc.memberHits.get(f.name)
      return {
        __proto__: null,
        use: 'soft',
        // Soft use behind isBuiltin() with a fallback ⇒ still droppable; the
        // gate must verify the fallback path runs without the binding.
        drop: true,
        reason: `isBuiltin-guarded use (${sig}) — droppable, gate must verify fallback`,
        note: 'soft use: gate runs the fallback path',
      }
    }
    const sig = acc.stringHits.get(f.name) ?? acc.memberHits.get(f.name)
    return {
      __proto__: null,
      use: 'hard',
      drop: false,
      reason: `used (${sig})`,
    }
  }

  // No evidence of use ⇒ drop (auto policy).
  return {
    __proto__: null,
    use: 'none',
    drop: true,
    reason: 'no usage signals found',
  }
}

export function dedupe(xs: string[]): string[] {
  return [...new Set(xs)]
}

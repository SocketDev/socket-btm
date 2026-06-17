/**
 * @file Feature-aware test predicate for the built node-smol binary. Existing
 *   smol tests gate on binary PRESENCE via `it.skipIf(!smolBinary)`. Once the
 *   bundle feature detector compiles features out per-bundle (see
 *   docs/plans/bundle-driven-module-detection.md), a test for e.g.
 *   `node:smol-quic` would run against a binary that deliberately excludes QUIC
 *   and fail. This helper extends the idiom from "is there a smol binary" to
 *   "does THIS binary include feature X", keyed on the smol-features registry.
 *   Usage in a per-feature suite: import { has, smolBinary } from
 *   '../helpers/smol-features.mts' describe.skipIf(!smolBinary ||
 *   !has('quic'))('node:smol-quic', () => { … }) Implementation note (DRY):
 *   `has()` delegates to the existing `smolBuiltinIsAvailable()` in
 *   smol-builtin.mts, which probes `isBuiltin('node:<specifier>')` on the
 *   binary. That is the GROUND-TRUTH signal — when the detector drops a
 *   feature, its gyp gate excludes the binding so the module no longer resolves
 *   AND `process.config.variables.node_use_smol_*` flips — and we reuse the
 *   established probe rather than re-implementing binary spawn. The full-build
 *   CI lane sets SOCKET_REQUIRE_ALL_FEATURES=1 so a missing gated feature is a
 *   HARD failure (via missingRequiredFeatures) rather than a silent skip —
 *   "skipped" must not mask a broken full build.
 */

import {
  featureBuiltinSpecifier,
  getFeature,
  SMOL_FEATURES,
} from '../../scripts/lib/smol-features.mts'
import { resolveFinalBinary, smolBuiltinIsAvailable } from './smol-builtin.mts'

/**
 * Path to the smol binary under test, or undefined if none is built.
 */
export const smolBinary: string | undefined = resolveFinalBinary()

const availabilityCache = new Map<string, boolean>()

/**
 * True when the built smol binary includes `feature` (by registry name).
 *
 * - Unknown feature name → throws (catches typos in test code).
 * - No binary built → false (pair with `!smolBinary` in skipIf).
 * - Feature with a `node:` specifier → delegates to `smolBuiltinIsAvailable` (the
 *   canonical isBuiltin probe), cached per feature.
 * - Feature with no importable specifier (e.g. `intl`, `temporal` — reached via
 *   globals) → true whenever a binary exists: these are never gated out by the
 *   detector (policy `keep-unless-explicit`), so their tests always apply.
 */
export function has(feature: string): boolean {
  const def = getFeature(feature)
  if (!def) {
    throw new Error(
      `has(${JSON.stringify(feature)}): unknown smol feature. Known: ${SMOL_FEATURES.map(f => f.name).join(', ')}`,
    )
  }
  if (!smolBinary) {
    return false
  }
  const specifier = featureBuiltinSpecifier(feature)
  if (!specifier) {
    // No importable module (intl/temporal/etc.) — present whenever the binary is.
    return true
  }
  const cached = availabilityCache.get(feature)
  if (cached !== undefined) {
    return cached
  }
  // smolBuiltinIsAvailable expects the name WITHOUT the `node:` prefix.
  const available = smolBuiltinIsAvailable(specifier.replace(/^node:/, ''))
  availabilityCache.set(feature, available)
  return available
}

/**
 * Full-build CI lane guard. When SOCKET_REQUIRE_ALL_FEATURES is set AND a
 * binary is built, returns the gated features the binary is MISSING (empty when
 * all present) so the caller can assert emptiness — turning an unexpected skip
 * into a hard failure. No-op (returns []) when the env var is unset or no
 * binary exists. "Gated" = has a gypVar; always-on features have no flag to
 * miss.
 */
export function missingRequiredFeatures(): string[] {
  if (!process.env['SOCKET_REQUIRE_ALL_FEATURES'] || !smolBinary) {
    return []
  }
  return SMOL_FEATURES.filter(f => f.gypVar)
    .filter(f => !has(f.name))
    .map(f => f.name)
}

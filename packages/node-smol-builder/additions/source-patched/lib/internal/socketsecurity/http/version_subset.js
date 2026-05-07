'use strict'

const {
  ArrayPrototypeEvery,
  ArrayPrototypeSome,
  hardenRegExp,
  JSONStringify,
  NumberParseInt,
  NumberPrototypeToFixed,
  ObjectKeys,
  RegExpPrototypeExec,
  RegExpPrototypeTest,
  StringPrototypeIncludes,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeTrim,
} = primordials

// Hoist all regex literals to module scope so they are compiled once and
// protected from prototype pollution.
//
// Strict semver: trailing content is ONLY allowed as a `-<prerelease>` tag
// or `+<build>` metadata. Whitespace, operators, or leftover fragments
// (e.g. "1.0.0 <2.0.0") cause parse to return undefined so compound
// ranges don't silently succeed.
//
// Prerelease/build patterns match versions.js exactly:
//   prerelease = [0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*
//   build      = same pattern after `+`
// This rejects malformed inputs like "1.0.0-.foo" or "1.0.0-foo..bar".
const SEMVER_REGEX = hardenRegExp(
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
)

// Whitespace detector for compound AND-ranges (e.g. ">=1.0.0 <2.0.0").
const WHITESPACE_REGEX = hardenRegExp(/\s+/)

// Strip the space between a comparison operator and its version, so that
// `>= 1.0.0` normalizes to `>=1.0.0`. Without this the whitespace-split for
// compound AND-ranges would treat the operator and version as two separate
// parts (e.g. [">=", "1.0.0"]) and return false for every version.
// Operators are the full npm set: >= > <= < = ^ ~ .
const OPERATOR_SPACE_REGEX = hardenRegExp(/(>=?|<=?|\^|~|=)\s+/g)

// Strip a leading comparator operator so we can isolate the range's base
// version for prerelease-tuple comparison. Matches the operator set used
// by the satisfies() branches below.
const OP_PREFIX_REGEX = hardenRegExp(/^(>=|<=|>|<|\^|~|=)/)

// Packument version subsetting - send only matching versions.
// 90-95% bandwidth reduction for popular packages.
// 5-10x faster JSON parsing on client.

// Simple semver implementation (subset of full semver).
// For production use, consider using the full 'semver' npm package.
const semver = {
  __proto__: null,
  // Parse version string.
  parse(version) {
    const match = RegExpPrototypeExec(SEMVER_REGEX, version)
    if (!match) {
      return undefined
    }

    return {
      __proto__: null,
      major: NumberParseInt(match[1], 10),
      minor: NumberParseInt(match[2], 10),
      patch: NumberParseInt(match[3], 10),
      prerelease: match[4] || '',
    }
  },

  // Check if version satisfies range.
  satisfies(version, range) {
    // Handle special cases.
    if (range === '' || range === '*' || range === 'latest') {
      return true
    }

    // npm `||` OR-ranges: any alternative satisfies.
    // Split before parsing so `^1.0.0 || ^2.0.0` routes into two recursive
    // `satisfies` calls, not into the permissive `^` regex below.
    if (StringPrototypeIncludes(range, '||')) {
      const alternatives = StringPrototypeSplit(range, '||')
      return ArrayPrototypeSome(alternatives, alt =>
        semver.satisfies(version, StringPrototypeTrim(alt)),
      )
    }

    // npm compound AND-ranges: `>=1.0.0 <2.0.0` — all parts must satisfy.
    // Split on whitespace AFTER `||` handling so OR takes precedence.
    // The strict SEMVER_REGEX would otherwise reject the leftover fragment
    // and return false for every version.
    //
    // First normalize operator+space forms like `>= 1.0.0` into `>=1.0.0`
    // so the whitespace-split only triggers on true AND-range boundaries.
    // Without this, `>= 1.0.0` splits into [">=", "1.0.0"] and every
    // version falls through to `false`.
    const normalized = StringPrototypeReplace(
      StringPrototypeTrim(range),
      OPERATOR_SPACE_REGEX,
      '$1',
    )
    if (RegExpPrototypeTest(WHITESPACE_REGEX, normalized)) {
      const parts = StringPrototypeSplit(normalized, WHITESPACE_REGEX)
      return ArrayPrototypeEvery(parts, part =>
        semver.satisfies(version, part),
      )
    }

    // Parse version.
    const ver = semver.parse(version)
    if (!ver) {
      return false
    }

    // Per npm semver spec, prerelease versions only match ranges that
    // explicitly include a prerelease tag on the SAME [major,minor,patch]
    // tuple. Without this guard, `1.2.3-beta.1` would satisfy `^1.0.0`
    // and leak prerelease data into packument responses trimmed for
    // stable consumers.
    if (ver.prerelease) {
      // Strip the leading operator to find the range's base version.
      const rangeVerStr = StringPrototypeReplace(
        normalized,
        OP_PREFIX_REGEX,
        '',
      )
      const rangeVer = semver.parse(rangeVerStr)
      if (
        !rangeVer ||
        !rangeVer.prerelease ||
        rangeVer.major !== ver.major ||
        rangeVer.minor !== ver.minor ||
        rangeVer.patch !== ver.patch
      ) {
        return false
      }
    }

    // All remaining branches operate on `normalized` so operator+space
    // input (e.g. `>= 1.0.0`, `^ 1.0.0`) is treated identically to the
    // no-space form. The WHITESPACE check above already peeled off true
    // AND-ranges, so whatever remains here is a single comparator.

    // Handle caret range (^X.Y.Z) — npm semver semantics:
    //   ^X.Y.Z with X>0   → >= X.Y.Z  <(X+1).0.0
    //   ^0.Y.Z with Y>0   → >= 0.Y.Z  <0.(Y+1).0
    //   ^0.0.Z            → >= 0.0.Z  <0.0.(Z+1)   (exact patch only)
    // The three branches are distinct because semver treats 0.* as
    // "pre-stable" and tightens the allowed range accordingly.
    if (StringPrototypeStartsWith(normalized, '^')) {
      const base = semver.parse(StringPrototypeSlice(normalized, 1))
      if (!base) {
        return false
      }

      if (base.major > 0) {
        return (
          ver.major === base.major &&
          (ver.minor > base.minor ||
            (ver.minor === base.minor && ver.patch >= base.patch))
        )
      }
      if (base.minor > 0) {
        return (
          ver.major === 0 &&
          ver.minor === base.minor &&
          ver.patch >= base.patch
        )
      }
      // ^0.0.Z — only exact patch matches.
      return (
        ver.major === 0 && ver.minor === 0 && ver.patch === base.patch
      )
    }

    // Handle tilde range (~1.2.3).
    if (StringPrototypeStartsWith(normalized, '~')) {
      const base = semver.parse(StringPrototypeSlice(normalized, 1))
      if (!base) {
        return false
      }

      return (
        ver.major === base.major &&
        ver.minor === base.minor &&
        ver.patch >= base.patch
      )
    }

    // Handle >= range.
    if (StringPrototypeStartsWith(normalized, '>=')) {
      const base = semver.parse(StringPrototypeSlice(normalized, 2))
      if (!base) {
        return false
      }

      return (
        ver.major > base.major ||
        (ver.major === base.major && ver.minor > base.minor) ||
        (ver.major === base.major &&
          ver.minor === base.minor &&
          ver.patch >= base.patch)
      )
    }

    // Handle > range.
    if (StringPrototypeStartsWith(normalized, '>')) {
      const base = semver.parse(StringPrototypeSlice(normalized, 1))
      if (!base) {
        return false
      }

      return (
        ver.major > base.major ||
        (ver.major === base.major && ver.minor > base.minor) ||
        (ver.major === base.major &&
          ver.minor === base.minor &&
          ver.patch > base.patch)
      )
    }

    // Handle <= range.
    if (StringPrototypeStartsWith(normalized, '<=')) {
      const base = semver.parse(StringPrototypeSlice(normalized, 2))
      if (!base) {
        return false
      }

      return (
        ver.major < base.major ||
        (ver.major === base.major && ver.minor < base.minor) ||
        (ver.major === base.major &&
          ver.minor === base.minor &&
          ver.patch <= base.patch)
      )
    }

    // Handle < range.
    if (StringPrototypeStartsWith(normalized, '<')) {
      const base = semver.parse(StringPrototypeSlice(normalized, 1))
      if (!base) {
        return false
      }

      return (
        ver.major < base.major ||
        (ver.major === base.major && ver.minor < base.minor) ||
        (ver.major === base.major &&
          ver.minor === base.minor &&
          ver.patch < base.patch)
      )
    }

    // Handle exact match.
    return version === normalized
  },
}

// Subset packument to only include matching versions.
function subsetPackument(packument, versionRange) {
  // Validate inputs.
  if (!packument || !packument.versions) {
    return packument
  }

  // Default to all versions if no range specified.
  if (!versionRange || versionRange === '*' || versionRange === 'latest') {
    return packument
  }

  // Filter versions matching range.
  const matchingVersions = { __proto__: null }
  let matchCount = 0

  const versionKeys = ObjectKeys(packument.versions)
  for (let i = 0; i < versionKeys.length; i++) {
    const version = versionKeys[i]
    if (semver.satisfies(version, versionRange)) {
      matchingVersions[version] = packument.versions[version]
      matchCount++
    }
  }

  // If no versions match, return full packument (let client handle error).
  if (matchCount === 0) {
    return packument
  }

  // Return subset packument.
  return {
    __proto__: null,
    ...packument,
    versions: matchingVersions,
    _subsetted: true,
    _matched_count: matchCount,
    _original_count: ObjectKeys(packument.versions).length,
    _range: versionRange,
  }
}

// Get subset statistics.
function getSubsetStats(original, subset) {
  const originalSize = JSONStringify(original).length
  const subsetSize = JSONStringify(subset).length
  // Guard against originalSize === 0 (empty packument or weird toJSON);
  // 1 - x/0 yields NaN which JSON-serializes to null and breaks dashboards.
  const reduction = originalSize > 0 ? 1 - subsetSize / originalSize : 0

  return {
    __proto__: null,
    bandwidth_saved: originalSize - subsetSize,
    original_count: ObjectKeys(original.versions || {}).length,
    original_size: originalSize,
    reduction_percent: NumberPrototypeToFixed(reduction * 100, 2),
    subset_count: ObjectKeys(subset.versions || {}).length,
    subset_size: subsetSize,
  }
}

module.exports = {
  __proto__: null,
  getSubsetStats,
  semver,
  subsetPackument,
}

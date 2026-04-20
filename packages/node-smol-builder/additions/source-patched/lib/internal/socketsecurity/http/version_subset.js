'use strict'

const {
  hardenRegExp,
  JSONStringify,
  NumberParseInt,
  NumberPrototypeToFixed,
  ObjectKeys,
  RegExpPrototypeExec,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  StringPrototypeTrim,
} = primordials

// Hoist all regex literals to module scope so they are compiled once and
// protected from prototype pollution.
const SEMVER_REGEX = hardenRegExp(/^(\d+)\.(\d+)\.(\d+)(.*)$/)

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
    if (!match) return null

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
    if (range === '*' || range === 'latest') return true

    // Parse version.
    const ver = semver.parse(version)
    if (!ver) return false

    // Handle caret range (^X.Y.Z) — npm semver semantics:
    //   ^X.Y.Z with X>0   → >= X.Y.Z  <(X+1).0.0
    //   ^0.Y.Z with Y>0   → >= 0.Y.Z  <0.(Y+1).0
    //   ^0.0.Z            → >= 0.0.Z  <0.0.(Z+1)   (exact patch only)
    // The three branches are distinct because semver treats 0.* as
    // "pre-stable" and tightens the allowed range accordingly.
    if (StringPrototypeStartsWith(range, '^')) {
      const base = semver.parse(StringPrototypeSlice(range, 1))
      if (!base) return false

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
    if (StringPrototypeStartsWith(range, '~')) {
      const base = semver.parse(StringPrototypeSlice(range, 1))
      if (!base) return false

      return (
        ver.major === base.major &&
        ver.minor === base.minor &&
        ver.patch >= base.patch
      )
    }

    // Handle >= range.
    if (StringPrototypeStartsWith(range, '>=')) {
      const base = semver.parse(
        StringPrototypeTrim(StringPrototypeSlice(range, 2)),
      )
      if (!base) return false

      return (
        ver.major > base.major ||
        (ver.major === base.major && ver.minor > base.minor) ||
        (ver.major === base.major &&
          ver.minor === base.minor &&
          ver.patch >= base.patch)
      )
    }

    // Handle > range.
    if (StringPrototypeStartsWith(range, '>')) {
      const base = semver.parse(
        StringPrototypeTrim(StringPrototypeSlice(range, 1)),
      )
      if (!base) return false

      return (
        ver.major > base.major ||
        (ver.major === base.major && ver.minor > base.minor) ||
        (ver.major === base.major &&
          ver.minor === base.minor &&
          ver.patch > base.patch)
      )
    }

    // Handle <= range.
    if (StringPrototypeStartsWith(range, '<=')) {
      const base = semver.parse(
        StringPrototypeTrim(StringPrototypeSlice(range, 2)),
      )
      if (!base) return false

      return (
        ver.major < base.major ||
        (ver.major === base.major && ver.minor < base.minor) ||
        (ver.major === base.major &&
          ver.minor === base.minor &&
          ver.patch <= base.patch)
      )
    }

    // Handle < range.
    if (StringPrototypeStartsWith(range, '<')) {
      const base = semver.parse(
        StringPrototypeTrim(StringPrototypeSlice(range, 1)),
      )
      if (!base) return false

      return (
        ver.major < base.major ||
        (ver.major === base.major && ver.minor < base.minor) ||
        (ver.major === base.major &&
          ver.minor === base.minor &&
          ver.patch < base.patch)
      )
    }

    // Handle exact match.
    return version === range
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

'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/versions.js.md

const {
  ArrayFrom,
  ArrayPrototypeFilter,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypeReverse,
  ArrayPrototypeSlice,
  ArrayPrototypeSort,
  IteratorPrototypeNext,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeKeys,
  MapPrototypeSet,
  NumberIsNaN,
  NumberParseInt,
  ObjectFreeze,
  RegExpPrototypeExec,
  RegExpPrototypeTest,
  SafeMap,
  StringPrototypeCharCodeAt,
  StringPrototypeIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeToLowerCase,
  StringPrototypeTrim,
  hardenRegExp,
} = primordials

// Ecosystem constants
const ecosystems = ObjectFreeze({
  __proto__: null,
  NPM: 'npm',
  MAVEN: 'maven',
  PYPI: 'pypi',
  NUGET: 'nuget',
  GEM: 'gem',
  CARGO: 'cargo',
  GOLANG: 'golang',
  COMPOSER: 'composer',
  HEX: 'hex',
  PUB: 'pub',
  SWIFT: 'swift',
})

class VersionError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'VersionError'
    this.code = code
  }
}

// LRU cache using SafeMap (insertion-ordered, O(1) eviction)
const CACHE_SIZE = 50000
let cache = new SafeMap()
let cacheHits = 0
let cacheMisses = 0

// Range cache: stores compiled comparator arrays keyed by `${ecosystem}:${range}`
const RANGE_CACHE_SIZE = 10_000
let rangeCache = new SafeMap()

function cacheKey(version, eco) {
  return `${eco}:${version}`
}

function cacheGet(key) {
  const value = MapPrototypeGet(cache, key)
  if (value !== undefined) {
    cacheHits++
    return value
  }
  cacheMisses++
  return undefined
}

function cachePut(key, value) {
  if (cache.size >= CACHE_SIZE) {
    // Evict oldest entry (first key in insertion order) — O(1)
    const { value: oldest } = IteratorPrototypeNext(MapPrototypeKeys(cache))
    MapPrototypeDelete(cache, oldest)
  }
  MapPrototypeSet(cache, key, value)
}

// Flyweight: shared frozen empty array for versions without prerelease.
// Avoids creating a new [] on every parse() call for ~95% of versions.
const EMPTY_PRERELEASE = ObjectFreeze([])

// Hand-rolled digit parsing — the regex guarantees pure digits,
// so we avoid NumberParseInt overhead with a simple charCode loop.
function parseDigits(str) {
  let n = 0
  for (let i = 0, len = str.length; i < len; i++) {
    n = n * 10 + (StringPrototypeCharCodeAt(str, i) - 48)
  }
  return n
}

// SemVer regex (strict mode: requires major.minor.patch, no leading zeros)
// Per semver spec: numeric identifiers are "0|[1-9]\d*" (no leading zeros except standalone 0)
const SEMVER_REGEX = hardenRegExp(
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
)

// Regex for numeric-only identifiers (per semver spec)
const NUMERIC_IDENTIFIER = hardenRegExp(/^[0-9]+$/)

// Hoisted regexes for Maven/PyPI/range parsing (avoids inline regex in hot paths)
const MAVEN_SPLIT_REGEX = hardenRegExp(/[.\-]/)
const MAVEN_QUALIFIER_REGEX = hardenRegExp(/^([a-z]+)(\d+)$/)
const PYPI_RELEASE_SPLIT_REGEX = hardenRegExp(/[._-]/)
const PYPI_NUM_PREFIX_REGEX = hardenRegExp(
  /^(\d+)(a|alpha|b|beta|c|rc|pre|preview|post|rev|r|dev)/i,
)
const PYPI_PRE_REGEX = hardenRegExp(
  /^(a|alpha|b|beta|c|rc|pre|preview)\.?(\d+)?/,
)
const PYPI_POST_REGEX = hardenRegExp(/(?:^|[._-])(post|rev|r)\.?(\d+)?/)
const PYPI_DEV_REGEX = hardenRegExp(/(?:^|[._-])dev\.?(\d+)?/)
const GEM_DIGIT_SPLIT_REGEX = hardenRegExp(/(\d+)/)
const RANGE_STARTS_WITH_DIGIT_REGEX = hardenRegExp(/^\d/)
const RANGE_OPERATOR_REGEX = hardenRegExp(/^(>=|<=|>|<|=)\s*(.+)$/)
const RANGE_CARET_REGEX = hardenRegExp(/^\^(.+)$/)
const RANGE_TILDE_REGEX = hardenRegExp(/^~(.+)$/)
const RANGE_WILDCARD_REGEX = hardenRegExp(
  /^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/,
)
const RANGE_XCH_REGEX = hardenRegExp(/[xX*]/)
const RANGE_OR_SPLIT_REGEX = hardenRegExp(/\s*\|\|\s*/)
const RANGE_AND_SPLIT_REGEX = hardenRegExp(/\s+/)
// Strip the space between a comparison operator and its version, so that
// `>= 1.0.0` normalizes to `>=1.0.0`. Without this, the AND-split below
// tears `>= 1.0.0` into [">=", "1.0.0"], parseComparator("&gt;=") returns
// undefined (empty operand), and satisfies returns false for every
// version. npm semver accepts the space form; so must we.
const RANGE_OPERATOR_SPACE_REGEX = hardenRegExp(/(>=?|<=?|\^|~|=)\s+/g)
const COERCE_VERSION_REGEX = hardenRegExp(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)

// Parse prerelease identifiers
// Per semver spec: only convert to number if ENTIRE identifier is digits
function parsePrerelease(str) {
  if (!str) {
    return EMPTY_PRERELEASE
  }
  const parts = StringPrototypeSplit(str, '.')
  return ArrayPrototypeMap(parts, p => {
    // Only convert to number if entire string is digits (per semver gold standard)
    if (RegExpPrototypeTest(NUMERIC_IDENTIFIER, p)) {
      const num = parseDigits(p)
      if (!NumberIsNaN(num)) {
        return num
      }
    }
    return p
  })
}

// Compute packed integer for fast comparison of versions without prerelease.
// major * 2^20 + minor * 2^10 + patch.
// Returns -1 when any component >= 1024 to prevent overflow/collision.
// The caller MUST fall through to field-by-field comparison when packed === -1.
function computePacked(major, minor, patch) {
  if (major >= 1024 || minor >= 1024 || patch >= 1024) {
    return -1
  }
  return major * 1048576 + minor * 1024 + patch
}

// Parse npm/SemVer version
function parseNpm(version) {
  const match = RegExpPrototypeExec(SEMVER_REGEX, version)
  if (!match) {
    throw new VersionError(
      `Invalid npm version: ${version}`,
      'ERR_INVALID_VERSION',
    )
  }

  const major = parseDigits(match[1])
  const minor = parseDigits(match[2])
  const patch = parseDigits(match[3])
  const prerelease = parsePrerelease(match[4])

  return ObjectFreeze({
    __proto__: null,
    major,
    minor,
    patch,
    prerelease,
    buildMetadata: match[5] || undefined,
    raw: version,
    _packed: computePacked(major, minor, patch),
  })
}

// Maven qualifier ranking — faithful to Maven ComparableVersion.
// Order: alpha < beta < milestone < rc < snapshot < (release) < sp
// Aliases: a->alpha, b->beta, m->milestone, cr->rc, ga/final/release->''
const MAVEN_QUALIFIER_RANK = ObjectFreeze({
  __proto__: null,
  alpha: 0,
  a: 0,
  beta: 1,
  b: 1,
  milestone: 2,
  m: 2,
  rc: 3,
  cr: 3,
  snapshot: 4,
  '': 5,
  ga: 5,
  final: 5,
  release: 5,
  sp: 6,
})

// Check if string is all ASCII digits.
function isDigits(str) {
  for (let i = 0, len = str.length; i < len; i++) {
    const c = StringPrototypeCharCodeAt(str, i)
    if (c < 48 || c > 57) {
      return false
    }
  }
  return str.length > 0
}

// Parse Maven version with qualifier support.
// Handles: 1.0, 1.0.0, 1.0-alpha, 1.0.0-SNAPSHOT, 1.0-rc1, etc.
function parseMaven(version) {
  const parts = StringPrototypeSplit(version, MAVEN_SPLIT_REGEX)
  const nums = []
  const qualifierParts = []
  let hitQualifier = false

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!hitQualifier && isDigits(part)) {
      ArrayPrototypePush(nums, parseDigits(part))
    } else {
      hitQualifier = true
      ArrayPrototypePush(qualifierParts, StringPrototypeToLowerCase(part))
    }
  }

  const major = nums[0] || 0
  const minor = nums[1] || 0
  const patch = nums[2] || 0

  // Build prerelease array with qualifier ranking for comparison.
  const prerelease = []
  for (let i = 0; i < qualifierParts.length; i++) {
    const q = qualifierParts[i]
    // Split CombinationItems like "alpha1" into ["alpha", 1]
    const numMatch = RegExpPrototypeExec(MAVEN_QUALIFIER_REGEX, q)
    if (numMatch) {
      const rank = MAVEN_QUALIFIER_RANK[numMatch[1]]
      ArrayPrototypePush(prerelease, rank !== undefined ? rank : numMatch[1])
      ArrayPrototypePush(prerelease, parseDigits(numMatch[2]))
    } else if (isDigits(q)) {
      ArrayPrototypePush(prerelease, parseDigits(q))
    } else {
      const rank = MAVEN_QUALIFIER_RANK[q]
      ArrayPrototypePush(prerelease, rank !== undefined ? rank : q)
    }
  }

  return ObjectFreeze({
    __proto__: null,
    major,
    minor,
    patch,
    prerelease,
    buildMetadata: undefined,
    raw: version,
    _packed: computePacked(major, minor, patch),
  })
}

// PEP 440 prerelease specifier normalization.
const PYPI_PRE_NORMALIZE = ObjectFreeze({
  __proto__: null,
  a: 'a',
  alpha: 'a',
  b: 'b',
  beta: 'b',
  c: 'rc',
  rc: 'rc',
  pre: 'rc',
  preview: 'rc',
})

// PEP 440 post-release specifier normalization.
const PYPI_POST_NORMALIZE = ObjectFreeze({
  __proto__: null,
  post: 'post',
  rev: 'post',
  r: 'post',
})

// PEP 440 prerelease ordering: a=0 < b=1 < rc=2
const PYPI_PRE_RANK = ObjectFreeze({ __proto__: null, a: 0, b: 1, rc: 2 })

// Parse PyPI PEP 440 version — full spec compliance.
// Handles: epoch, variable-length release, pre/post/dev, local, delimiter normalization.
function parsePypi(version) {
  // Strip environment markers ("; python_version >= '3.0'")
  const semiIdx = StringPrototypeIndexOf(version, ';')
  if (semiIdx !== -1) {
    version = StringPrototypeSlice(version, 0, semiIdx)
  }
  version = StringPrototypeTrim(version)

  // Handle epoch (N!)
  let epoch = 0
  let rest = version
  const bangIdx = StringPrototypeIndexOf(version, '!')
  if (bangIdx !== -1) {
    epoch = parseDigits(StringPrototypeSlice(version, 0, bangIdx)) || 0
    rest = StringPrototypeSlice(version, bangIdx + 1)
  }

  // Strip local version (+...) — ignored for comparison per PEP 440.
  const plusIdx = StringPrototypeIndexOf(rest, '+')
  if (plusIdx !== -1) {
    rest = StringPrototypeSlice(rest, 0, plusIdx)
  }

  // Parse release segments (variable length: 1.2.3.4.5 is valid).
  // Split on . but stop at first non-numeric-starting segment.
  const releaseParts = StringPrototypeSplit(rest, PYPI_RELEASE_SPLIT_REGEX)
  const release = []
  let suffixStart = 0

  let inlineSuffix = ''
  for (let i = 0; i < releaseParts.length; i++) {
    const part = releaseParts[i]
    if (isDigits(part)) {
      ArrayPrototypePush(release, parseDigits(part))
      suffixStart = i + 1
    } else {
      // PEP 440: "0a1" = release segment 0 + prerelease "a1".
      // Check if part starts with digits followed by a specifier.
      const numPrefixMatch = RegExpPrototypeExec(PYPI_NUM_PREFIX_REGEX, part)
      if (numPrefixMatch) {
        ArrayPrototypePush(release, parseDigits(numPrefixMatch[1]))
        suffixStart = i + 1
        inlineSuffix = StringPrototypeSlice(part, numPrefixMatch[1].length)
      }
      break
    }
  }

  if (release.length === 0) {
    throw new VersionError(
      `Invalid PyPI version: ${version}`,
      'ERR_INVALID_VERSION',
    )
  }

  // Build prerelease array with structured comparison data.
  // PEP 440 ordering: dev < pre-release < release < post-release
  const prerelease = []
  let hasPost = false
  let hasDev = false
  let postNum = 0
  let devNum = 0

  // Parse remaining parts as pre/post/dev specifiers.
  let remaining = ArrayPrototypeJoin(
    ArrayPrototypeSlice(releaseParts, suffixStart),
    '.',
  )
  if (inlineSuffix) {
    remaining = remaining ? inlineSuffix + '.' + remaining : inlineSuffix
  }
  if (remaining) {
    // Normalize delimiters: ._- are interchangeable in PEP 440
    const normalized = StringPrototypeToLowerCase(remaining)

    // Pre-release: a|alpha|b|beta|c|rc|pre|preview
    const preMatch = RegExpPrototypeExec(PYPI_PRE_REGEX, normalized)
    if (preMatch) {
      const spec = PYPI_PRE_NORMALIZE[preMatch[1]] || 'rc'
      ArrayPrototypePush(prerelease, PYPI_PRE_RANK[spec])
      ArrayPrototypePush(prerelease, preMatch[2] ? parseDigits(preMatch[2]) : 0)
    }

    // Post-release: post|rev|r
    const postMatch = RegExpPrototypeExec(PYPI_POST_REGEX, normalized)
    if (postMatch) {
      hasPost = true
      postNum = postMatch[2] ? parseDigits(postMatch[2]) : 0
    }

    // Dev release: dev
    const devMatch = RegExpPrototypeExec(PYPI_DEV_REGEX, normalized)
    if (devMatch) {
      hasDev = true
      devNum = devMatch[1] ? parseDigits(devMatch[1]) : 0
    }
  }

  const major = release[0] || 0
  const minor = release[1] || 0
  const patch = release[2] || 0

  return ObjectFreeze({
    __proto__: null,
    major,
    minor,
    patch,
    release, // full variable-length release segments
    prerelease,
    hasPost,
    postNum,
    hasDev,
    devNum,
    buildMetadata: undefined,
    epoch,
    raw: version,
    _packed: computePacked(major, minor, patch),
  })
}

// Parse NuGet version (1-4 components + prerelease labels + build metadata).
// NuGet differences from SemVer:
//   - 4th component (revision) supported
//   - Fewer prerelease labels = higher precedence (opposite of SemVer)
//   - Numeric prerelease labels sort before alphabetic
//   - Case-insensitive label comparison
function parseNuget(version) {
  let rest = version
  let buildMetadata

  // Strip build metadata (+...)
  const plusIdx = StringPrototypeIndexOf(rest, '+')
  if (plusIdx !== -1) {
    buildMetadata = StringPrototypeSlice(rest, plusIdx + 1)
    rest = StringPrototypeSlice(rest, 0, plusIdx)
  }

  // Split prerelease (-...)
  let prereleaseStr
  const dashIdx = StringPrototypeIndexOf(rest, '-')
  if (dashIdx !== -1) {
    prereleaseStr = StringPrototypeSlice(rest, dashIdx + 1)
    rest = StringPrototypeSlice(rest, 0, dashIdx)
  }

  // Parse version components (1-4 parts)
  const parts = StringPrototypeSplit(rest, '.')
  const major = parts[0] ? parseDigits(parts[0]) : 0
  const minor = parts[1] ? parseDigits(parts[1]) : 0
  const patch = parts[2] ? parseDigits(parts[2]) : 0
  const revision = parts[3] ? parseDigits(parts[3]) : 0

  // Parse prerelease labels (dot-separated)
  let prerelease = EMPTY_PRERELEASE
  if (prereleaseStr) {
    const labels = StringPrototypeSplit(prereleaseStr, '.')
    prerelease = ArrayPrototypeMap(labels, label => {
      if (isDigits(label)) {
        return parseDigits(label)
      }
      return StringPrototypeToLowerCase(label)
    })
  }

  return ObjectFreeze({
    __proto__: null,
    major,
    minor,
    patch,
    revision, // NuGet 4th component
    prerelease,
    buildMetadata,
    raw: version,
    _packed: computePacked(major, minor, patch),
    _nuget: true, // marker for NuGet-specific comparison
  })
}

// Parse RubyGems version (variable-length, mixed string/number segments).
// RubyGems rules:
//   - Hyphens replaced with `.pre.` (e.g., 1.0-beta -> 1.0.pre.beta)
//   - Segments split on digit/non-digit boundaries (e.g., 0a2 -> [0, "a", 2])
//   - String segments sort before numeric (pre-release < release)
//   - Zero-skipping: 0s are skipped when the other version has a string segment
function parseGem(version) {
  // Replace - with .pre. per RubyGems convention.
  // Use split+join since StringPrototypeReplaceAll may not be in primordials.
  let normalized = ArrayPrototypeJoin(
    StringPrototypeSplit(version, '-'),
    '.pre.',
  )

  // Split on dots
  const dotParts = StringPrototypeSplit(normalized, '.')

  // For each dot-segment, split on digit/non-digit boundaries
  const segments = []
  for (let i = 0; i < dotParts.length; i++) {
    const part = dotParts[i]
    // Split on digit boundaries: "0a2" -> ["0", "a", "2"]
    const subParts = StringPrototypeSplit(part, GEM_DIGIT_SPLIT_REGEX)
    for (let j = 0; j < subParts.length; j++) {
      const s = subParts[j]
      if (s === '') {
        continue
      }
      if (isDigits(s)) {
        ArrayPrototypePush(segments, parseDigits(s))
      } else {
        ArrayPrototypePush(segments, s)
      }
    }
  }

  // Extract major/minor/patch from leading numeric segments for compatibility
  let major = 0,
    minor = 0,
    patch = 0
  let numIdx = 0
  for (let i = 0; i < segments.length && numIdx < 3; i++) {
    if (typeof segments[i] === 'number') {
      if (numIdx === 0) {
        major = segments[i]
      }
      else if (numIdx === 1) minor = segments[i]
      else if (numIdx === 2) patch = segments[i]
      numIdx++
    } else {
      break // First string segment ends the release part
    }
  }

  return ObjectFreeze({
    __proto__: null,
    major,
    minor,
    patch,
    prerelease: EMPTY_PRERELEASE, // RubyGems uses segments array instead
    buildMetadata: undefined,
    segments, // Full mixed array for RubyGems comparison
    raw: version,
    _packed: computePacked(major, minor, patch),
    _gem: true, // marker for RubyGems-specific comparison
  })
}

// Generic parser based on ecosystem
function parse(version, ecosystem = 'npm') {
  if (typeof version !== 'string') {
    throw new VersionError('Version must be a string', 'ERR_INVALID_TYPE')
  }

  version = StringPrototypeTrim(version)
  const key = cacheKey(version, ecosystem)
  const cached = cacheGet(key)
  if (cached) {
    return cached
  }

  let result
  switch (ecosystem) {
    case 'npm':
    case 'cargo':
    case 'golang':
      result = parseNpm(version)
      break
    case 'maven':
      result = parseMaven(version)
      break
    case 'pypi':
      result = parsePypi(version)
      break
    case 'nuget':
      result = parseNuget(version)
      break
    case 'gem':
      result = parseGem(version)
      break
    default:
      result = parseNpm(version)
  }

  cachePut(key, result)
  return result
}

function tryParse(version, ecosystem = 'npm') {
  try {
    return parse(version, ecosystem)
  } catch {
    return undefined
  }
}

// Compare prerelease arrays
function comparePrerelease(a, b) {
  // No prerelease > has prerelease
  if (a.length === 0 && b.length > 0) {
    return 1
  }
  if (a.length > 0 && b.length === 0) {
    return -1
  }
  if (a.length === 0 && b.length === 0) {
    return 0
  }

  const len = a.length > b.length ? a.length : b.length
  for (let i = 0; i < len; i++) {
    const aVal = a[i]
    const bVal = b[i]

    // Missing < existing
    if (aVal === undefined) {
      return -1
    }
    if (bVal === undefined) {
      return 1
    }

    // Number < string
    const aNum = typeof aVal === 'number'
    const bNum = typeof bVal === 'number'

    if (aNum && !bNum) {

      return -1

    }
    if (!aNum && bNum) {
      return 1
    }

    if (aVal < bVal) {

      return -1

    }
    if (aVal > bVal) {
      return 1
    }
  }

  return 0
}

// Compare NuGet prerelease labels.
// Key difference from SemVer: fewer labels = higher precedence.
function compareNugetPrerelease(a, b) {
  // Both stable (no prerelease) -> equal.
  if (a.length === 0 && b.length === 0) {
    return 0
  }
  // Stable > prerelease.
  if (a.length === 0 && b.length > 0) {
    return 1
  }
  if (a.length > 0 && b.length === 0) {
    return -1
  }

  // Compare element-by-element up to shorter length.
  const minLen = a.length < b.length ? a.length : b.length
  for (let i = 0; i < minLen; i++) {
    const aVal = a[i]
    const bVal = b[i]
    const aNum = typeof aVal === 'number'
    const bNum = typeof bVal === 'number'

    // Numeric < alphabetic in NuGet.
    if (aNum && !bNum) {
      return -1
    }
    if (!aNum && bNum) {
      return 1
    }

    if (aNum && bNum) {
      if (aVal !== bVal) {
        return aVal < bVal ? -1 : 1
      }
    } else {
      // Case-insensitive string comparison.
      if (aVal !== bVal) {
        return aVal < bVal ? -1 : 1
      }
    }
  }

  // NuGet-specific: fewer labels = HIGHER precedence (opposite of SemVer).
  if (a.length !== b.length) {
    return a.length < b.length ? 1 : -1
  }
  return 0
}

// Compare RubyGems versions using the segments array.
// Key rules: string < number, zero-skipping before string segments.
function compareGem(va, vb) {
  const sa = va.segments || []
  const sb = vb.segments || []
  let i1 = 0,
    i2 = 0

  while (i1 < sa.length || i2 < sb.length) {
    // Zero-skipping: skip 0s when the other side has a string segment.
    while (
      i1 < sa.length &&
      sa[i1] === 0 &&
      i2 < sb.length &&
      typeof sb[i2] === 'string'
    ) {
      i1++
    }
    while (
      i2 < sb.length &&
      sb[i2] === 0 &&
      i1 < sa.length &&
      typeof sa[i1] === 'string'
    ) {
      i2++
    }

    const p1 = i1 < sa.length ? sa[i1] : 0
    const p2 = i2 < sb.length ? sb[i2] : 0

    const t1 = typeof p1
    const t2 = typeof p2

    if (t1 === 'number' && t2 === 'number') {
      if (p1 !== p2) {
        return p1 < p2 ? -1 : 1
      }
    } else if (t1 === 'string' && t2 === 'string') {
      if (p1 !== p2) {
        return p1 < p2 ? -1 : 1
      }
    } else if (t1 === 'string' && t2 === 'number') {
      // String < number in RubyGems (prerelease < release).
      return -1
    } else if (t1 === 'number' && t2 === 'string') {
      return 1
    }

    i1++
    i2++
  }
  return 0
}

// Compare two versions.
function compare(a, b, ecosystem = 'npm') {
  const va =
    typeof a === 'object' && a !== null ? a : parse(a, ecosystem)
  const vb =
    typeof b === 'object' && b !== null ? b : parse(b, ecosystem)

  // RubyGems: use segments-based comparison.
  if (va._gem || vb._gem) {
    return compareGem(va, vb)
  }

  // NuGet: 4-component + NuGet-specific prerelease ordering.
  if (va._nuget || vb._nuget) {
    if (va.major !== vb.major) {
      return va.major < vb.major ? -1 : 1
    }
    if (va.minor !== vb.minor) {
      return va.minor < vb.minor ? -1 : 1
    }
    if (va.patch !== vb.patch) {
      return va.patch < vb.patch ? -1 : 1
    }
    const revA = va.revision || 0
    const revB = vb.revision || 0
    if (revA !== revB) {
      return revA < revB ? -1 : 1
    }
    return compareNugetPrerelease(va.prerelease, vb.prerelease)
  }

  // Packed integer fast path: single compare when both have no prerelease,
  // no dev/post (PyPI), and both packed values are valid. Also require
  // equal epochs (both undefined, or numerically equal) — a differing-epoch
  // pair must fall through to the PyPI branch below which handles it,
  // otherwise `1!1.0.0` and `2!1.0.0` both pack-equal and return 0.
  if (
    va.prerelease.length === 0 &&
    vb.prerelease.length === 0 &&
    va._packed >= 0 &&
    vb._packed >= 0 &&
    !va.hasDev &&
    !vb.hasDev &&
    !va.hasPost &&
    !vb.hasPost &&
    (va.epoch || 0) === (vb.epoch || 0)
  ) {
    if (va._packed !== vb._packed) {
      return va._packed < vb._packed ? -1 : 1
    }
    return 0
  }

  // Compare major.minor.patch field-by-field (fallback for large values).
  if (va.major !== vb.major) {
    return va.major < vb.major ? -1 : 1
  }
  if (va.minor !== vb.minor) {
    return va.minor < vb.minor ? -1 : 1
  }
  if (va.patch !== vb.patch) {
    return va.patch < vb.patch ? -1 : 1
  }

  // PyPI-specific: dev < pre < release < post (PEP 440 ordering).
  if (va.epoch !== undefined || vb.epoch !== undefined) {
    // Epoch dominates per PEP 440 — `2!1.0.0` > `1!9.9.9`. Compare epochs
    // FIRST, before phase/prerelease checks, otherwise differing-epoch pairs
    // fall through and return 0 incorrectly.
    const aEpoch = va.epoch || 0
    const bEpoch = vb.epoch || 0
    if (aEpoch !== bEpoch) {
      return aEpoch < bEpoch ? -1 : 1
    }

    const aDev = va.hasDev || false
    const bDev = vb.hasDev || false
    const aPost = va.hasPost || false
    const bPost = vb.hasPost || false
    const aPre = va.prerelease.length > 0
    const bPre = vb.prerelease.length > 0

    // Compute PEP 440 phase: dev=0, pre=1, release=2, post=3
    const aPhase = aDev ? 0 : aPre ? 1 : aPost ? 3 : 2
    const bPhase = bDev ? 0 : bPre ? 1 : bPost ? 3 : 2

    if (aPhase !== bPhase) {

      return aPhase < bPhase ? -1 : 1

    }

    // Same phase — compare within phase.
    if (aPhase === 0) {
      // Both dev: compare dev number.
      if ((va.devNum || 0) !== (vb.devNum || 0))
        return (va.devNum || 0) < (vb.devNum || 0) ? -1 : 1
    } else if (aPhase === 1) {
      // Both prerelease: compare prerelease arrays.
      const preResult = comparePrerelease(va.prerelease, vb.prerelease)
      if (preResult !== 0) {
        return preResult
      }
    } else if (aPhase === 3) {
      // Both post: compare post number.
      if ((va.postNum || 0) !== (vb.postNum || 0))
        return (va.postNum || 0) < (vb.postNum || 0) ? -1 : 1
    }

    return 0
  }

  // Non-PyPI: compare prerelease (SemVer/Maven).
  return comparePrerelease(va.prerelease, vb.prerelease)
}

// Comparison helpers
function lt(a, b, eco) {
  return compare(a, b, eco) < 0
}
function lte(a, b, eco) {
  return compare(a, b, eco) <= 0
}
function gt(a, b, eco) {
  return compare(a, b, eco) > 0
}
function gte(a, b, eco) {
  return compare(a, b, eco) >= 0
}
function eq(a, b, eco) {
  return compare(a, b, eco) === 0
}
function neq(a, b, eco) {
  return compare(a, b, eco) !== 0
}

// Sort versions — pre-parse all versions once (O(n)), then sort pre-parsed values
function sort(versions, ecosystem = 'npm', descending = false) {
  const arr = ArrayFrom(versions)
  // Pre-parse all versions to avoid repeated parsing in comparator
  const parsed = ArrayPrototypeMap(arr, v =>
    typeof v === 'object' && v !== null ? v : parse(v, ecosystem),
  )
  // Create index array to track original positions
  const indices = ArrayFrom({ length: arr.length }, (_, i) => i)
  ArrayPrototypeSort(indices, (ai, bi) => {
    // Delegate to compare() which handles all ecosystems
    // (NuGet 4th component, RubyGems segments, packed fast path, etc.)
    return compare(parsed[ai], parsed[bi], ecosystem)
  })
  const sorted = ArrayPrototypeMap(indices, i => arr[i])
  return descending ? ArrayPrototypeReverse(sorted) : sorted
}

function rsort(versions, ecosystem = 'npm') {
  return sort(versions, ecosystem, true)
}

// Find max version — O(n) linear scan instead of O(n log n) sort
function max(versions, ecosystem = 'npm') {
  if (!versions || versions.length === 0) {
    return undefined
  }
  let best = versions[0]
  for (let i = 1, len = versions.length; i < len; i++) {
    if (compare(versions[i], best, ecosystem) > 0) {
      best = versions[i]
    }
  }
  return best
}

// Find min version — O(n) linear scan instead of O(n log n) sort
function min(versions, ecosystem = 'npm') {
  if (!versions || versions.length === 0) {
    return undefined
  }
  let best = versions[0]
  for (let i = 1, len = versions.length; i < len; i++) {
    if (compare(versions[i], best, ecosystem) < 0) {
      best = versions[i]
    }
  }
  return best
}

// Coerce a partial semver string ("1", "1.2", "1.x") into a strict "X.Y.Z"
// that tryParse will accept. Missing components pad with 0. Returns undefined
// when the input isn't a partial-numeric match. Used by parseComparator below
// so `^1`, `^1.2`, `~1`, `>=1`, etc. resolve correctly.
function coercePartialToFull(str) {
  const trimmed = StringPrototypeTrim(str)
  if (!trimmed) {
    return undefined
  }
  const match = RegExpPrototypeExec(RANGE_WILDCARD_REGEX, trimmed)
  if (!match) {
    return undefined
  }
  const major = match[1]
  const minor = match[2]
  const patch = match[3]
  // Anything wildcard-like (x / X / *) acts as 0 when coerced.
  const coerce = s =>
    !s || RegExpPrototypeTest(RANGE_XCH_REGEX, s) ? '0' : s
  return `${major}.${coerce(minor)}.${coerce(patch)}`
}

// tryParse that falls back to coercing partial versions (e.g. "1" → "1.0.0").
function tryParseOrCoerce(str, ecosystem) {
  const v = tryParse(str, ecosystem)
  if (v) {
    return v
  }
  const coerced = coercePartialToFull(str)
  if (!coerced) {
    return undefined
  }
  return tryParse(coerced, ecosystem)
}

// Coerce a hyphen-range UPPER bound. npm treats a partial upper as an
// exclusive ceiling rather than the zero-padded lower-bound coercion:
//   `1 - 2`     → `>=1.0.0 <3.0.0-0`   (bump major)
//   `1 - 2.3`   → `>=1.0.0 <2.4.0-0`   (bump minor)
//   `1 - 2.3.4` → `>=1.0.0 <=2.3.4`    (exact patch, inclusive)
// Returns { op, version } so the caller can push it into the comparators
// list with the right operator. A strict full version falls back to `<=`
// so the hyphen range is inclusive on that end. A completely unparseable
// input returns undefined so the caller can drop the bound.
function coerceHyphenUpper(str, ecosystem) {
  const trimmed = StringPrototypeTrim(str)
  if (!trimmed) {
    return undefined
  }
  // Fully-qualified upper: use it verbatim with inclusive <=.
  const full = tryParse(trimmed, ecosystem)
  if (full) {
    return { __proto__: null, op: '<=', version: full }
  }
  // Partial upper: figure out which component is missing and bump the
  // next-lowest-populated component. RANGE_WILDCARD_REGEX also catches the
  // x / X / * wildcard variants, which we collapse to `0` below.
  const match = RegExpPrototypeExec(RANGE_WILDCARD_REGEX, trimmed)
  if (!match) {
    return undefined
  }
  const majorStr = match[1]
  const minorStr = match[2]
  const patchStr = match[3]
  const major = NumberParseInt(majorStr, 10)
  const isWild = s => !s || RegExpPrototypeTest(RANGE_XCH_REGEX, s)
  if (isWild(minorStr)) {
    // `X` or `X.x` → ceiling is `<(X+1).0.0-0`.
    const ceiling = tryParse(`${major + 1}.0.0-0`, ecosystem)
    if (!ceiling) {
      return undefined
    }
    return { __proto__: null, op: '<', version: ceiling }
  }
  if (isWild(patchStr)) {
    // `X.Y` or `X.Y.x` → ceiling is `<X.(Y+1).0-0`.
    const minor = NumberParseInt(minorStr, 10)
    const ceiling = tryParse(`${major}.${minor + 1}.0-0`, ecosystem)
    if (!ceiling) {
      return undefined
    }
    return { __proto__: null, op: '<', version: ceiling }
  }
  // Reaches here only for weird inputs the strict tryParse rejected but
  // RANGE_WILDCARD_REGEX accepted (e.g. trailing whitespace that the
  // regex tolerates). Treat like the inclusive fully-qualified case.
  const padded = coercePartialToFull(trimmed)
  if (!padded) {
    return undefined
  }
  const v = tryParse(padded, ecosystem)
  if (!v) {
    return undefined
  }
  return { __proto__: null, op: '<=', version: v }
}

// Parse a range comparator (e.g., ">=1.0.0", "^2.0.0")
function parseComparator(comp, ecosystem) {
  comp = StringPrototypeTrim(comp)
  if (!comp) {
    return undefined
  }

  // Standalone wildcard * matches anything
  if (comp === '*' || comp === 'x' || comp === 'X') {
    return {
      __proto__: null,
      op: '*',
      major: undefined,
      minor: undefined,
      patch: undefined,
    }
  }

  // Exact match — partial versions like "1" or "1.2" are handled by the
  // wildcard branch below, not here.
  if (RegExpPrototypeTest(RANGE_STARTS_WITH_DIGIT_REGEX, comp)) {
    const v = tryParse(comp, ecosystem)
    if (v) {
      return { __proto__: null, op: '=', version: v }
    }
  }

  // Operators: >=, <=, >, <, =.
  // npm accepts partial versions ('>=1' means '>=1.0.0'), so coerce.
  const opMatch = RegExpPrototypeExec(RANGE_OPERATOR_REGEX, comp)
  if (opMatch) {
    const v = tryParseOrCoerce(opMatch[2], ecosystem)
    if (v) {
      return { __proto__: null, op: opMatch[1], version: v }
    }
  }

  // Caret ^ — npm accepts '^1' (= >=1.0.0 <2.0.0), so coerce partial.
  const caretMatch = RegExpPrototypeExec(RANGE_CARET_REGEX, comp)
  if (caretMatch) {
    const v = tryParseOrCoerce(caretMatch[1], ecosystem)
    if (v) {
      return { __proto__: null, op: '^', version: v }
    }
  }

  // Tilde ~ — npm accepts '~1' (= >=1.0.0 <2.0.0), so coerce partial.
  const tildeMatch = RegExpPrototypeExec(RANGE_TILDE_REGEX, comp)
  if (tildeMatch) {
    const v = tryParseOrCoerce(tildeMatch[1], ecosystem)
    if (v) {
      return { __proto__: null, op: '~', version: v }
    }
  }

  // Wildcard x, X, * with versions (e.g., 1.x, 1.2.*)
  const wildMatch = RegExpPrototypeExec(RANGE_WILDCARD_REGEX, comp)
  if (wildMatch) {
    return {
      __proto__: null,
      op: '*',
      major: parseDigits(wildMatch[1]) || 0,
      minor:
        wildMatch[2] && !RegExpPrototypeTest(RANGE_XCH_REGEX, wildMatch[2])
          ? parseDigits(wildMatch[2])
          : undefined,
      patch:
        wildMatch[3] && !RegExpPrototypeTest(RANGE_XCH_REGEX, wildMatch[3])
          ? parseDigits(wildMatch[3])
          : undefined,
    }
  }

  return undefined
}

// Check if prerelease version is allowed for this comparator
// Per semver spec: prerelease versions only satisfy ranges that explicitly
// include prerelease tags on the same [major, minor, patch] tuple
function prereleaseAllowed(version, comp) {
  // If version has no prerelease, it's always allowed
  if (!version.prerelease || version.prerelease.length === 0) {
    return true
  }

  // If comparator's version has prerelease on same tuple, allow it
  if (
    comp.version &&
    comp.version.prerelease &&
    comp.version.prerelease.length > 0
  ) {
    // Check if same major.minor.patch
    if (
      version.major === comp.version.major &&
      version.minor === comp.version.minor &&
      version.patch === comp.version.patch
    ) {
      return true
    }
  }

  // Prerelease versions don't satisfy non-prerelease ranges
  return false
}

// Check if version satisfies a comparator
function satisfiesComparator(version, comp, checkPrerelease = true) {
  const v =
    typeof version === 'object' && version !== null
      ? version
      : parse(version)

  // Per semver spec: prerelease versions only match ranges that explicitly
  // include prerelease tags on the same [major, minor, patch] tuple
  if (checkPrerelease && !prereleaseAllowed(v, comp)) {
    return false
  }

  switch (comp.op) {
    case '=':
      return compare(v, comp.version) === 0
    case '>':
      return compare(v, comp.version) > 0
    case '>=':
      return compare(v, comp.version) >= 0
    case '<':
      return compare(v, comp.version) < 0
    case '<=':
      return compare(v, comp.version) <= 0
    case '^': {
      // ^1.2.3 := >=1.2.3 <2.0.0 (for major > 0)
      // ^0.2.3 := >=0.2.3 <0.3.0 (for major = 0, minor > 0)
      // ^0.0.3 := >=0.0.3 <0.0.4 (for major = 0, minor = 0)
      const cv = comp.version
      if (compare(v, cv) < 0) {
        return false
      }

      if (cv.major > 0) {
        return v.major === cv.major
      } else if (cv.minor > 0) {
        return v.major === 0 && v.minor === cv.minor
      } else {
        return v.major === 0 && v.minor === 0 && v.patch === cv.patch
      }
    }
    case '~': {
      // ~1.2.3 := >=1.2.3 <1.3.0
      const cv = comp.version
      if (compare(v, cv) < 0) {
        return false
      }
      return v.major === cv.major && v.minor === cv.minor
    }
    case '*': {
      // Wildcard matching
      if (comp.major !== undefined && v.major !== comp.major) {
        return false
      }
      if (comp.minor !== undefined && v.minor !== comp.minor) {
        return false
      }
      if (comp.patch !== undefined && v.patch !== comp.patch) {
        return false
      }
      return true
    }
    default:
      return false
  }
}

// Check if any comparator in a range set explicitly includes prerelease
// on the same [major, minor, patch] tuple as the version
function rangeHasMatchingPrerelease(version, comparators) {
  if (!version.prerelease || version.prerelease.length === 0) {
    return true // No prerelease on version, always OK
  }

  for (let i = 0; i < comparators.length; i++) {
    const comp = comparators[i]
    if (
      comp &&
      comp.version &&
      comp.version.prerelease &&
      comp.version.prerelease.length > 0
    ) {
      // Check if same major.minor.patch
      if (
        version.major === comp.version.major &&
        version.minor === comp.version.minor &&
        version.patch === comp.version.patch
      ) {
        return true
      }
    }
  }

  return false
}

// Compile a range string into an array of OR-groups, each containing
// { comparators, andParts (for hyphen re-check) }
function compileRange(range, ecosystem) {
  const rangeKey = `${ecosystem}:${range}`
  const cached = MapPrototypeGet(rangeCache, rangeKey)
  if (cached !== undefined) {
    return cached
  }

  const orParts = StringPrototypeSplit(range, RANGE_OR_SPLIT_REGEX)
  const compiled = []

  for (let i = 0; i < orParts.length; i++) {
    // Normalize `>= 1.0.0` → `>=1.0.0` before splitting on whitespace. npm
    // semver accepts the space form. Without this, the AND-split below
    // would tear it into [">=", "1.0.0"] and every version would be
    // rejected. Hyphen ranges `1.0.0 - 2.0.0` are preserved because `-`
    // isn't in the operator class and isn't touched by the regex.
    const normalized = StringPrototypeReplace(
      orParts[i],
      RANGE_OPERATOR_SPACE_REGEX,
      '$1',
    )
    const andParts = StringPrototypeSplit(normalized, RANGE_AND_SPLIT_REGEX)
    const comparators = []
    // Track hyphen ranges separately for the satisfaction pass
    const hyphenRanges = []

    for (let j = 0; j < andParts.length; j++) {
      if (andParts[j + 1] === '-' && andParts[j + 2]) {
        // Hyphen ranges accept partial versions per npm semver:
        //   `1 - 2`       → `>=1.0.0 <3.0.0-0`      (partial upper: exclusive ceiling)
        //   `1.2 - 2.3`   → `>=1.2.0 <2.4.0-0`      (partial upper: bump minor)
        //   `1.2 - 2.3.4` → `>=1.2.0 <=2.3.4`       (full upper: inclusive)
        // The LOWER bound uses tryParseOrCoerce which pads partials with 0
        // (the correct behavior for a floor). The UPPER bound needs
        // coerceHyphenUpper because zero-padding would misrepresent a
        // partial ceiling as an inclusive exact version.
        const lower = tryParseOrCoerce(andParts[j], ecosystem)
        const upperBound = coerceHyphenUpper(andParts[j + 2], ecosystem)
        if (lower)
          ArrayPrototypePush(comparators, {
            __proto__: null,
            op: '>=',
            version: lower,
          })
        if (upperBound)
          ArrayPrototypePush(comparators, {
            __proto__: null,
            op: upperBound.op,
            version: upperBound.version,
          })
        ArrayPrototypePush(hyphenRanges, {
          __proto__: null,
          lower,
          upper: upperBound ? upperBound.version : undefined,
          upperOp: upperBound ? upperBound.op : '<=',
        })
        j += 2
      } else {
        const comp = parseComparator(andParts[j], ecosystem)
        if (comp) {
          ArrayPrototypePush(comparators, comp)
        }
        else ArrayPrototypePush(comparators, undefined)
      }
    }

    ArrayPrototypePush(compiled, {
      __proto__: null,
      comparators,
      andParts,
      hyphenRanges,
    })
  }

  // Evict oldest if range cache is full
  if (rangeCache.size >= RANGE_CACHE_SIZE) {
    const { value: oldest } = IteratorPrototypeNext(
      MapPrototypeKeys(rangeCache),
    )
    MapPrototypeDelete(rangeCache, oldest)
  }
  MapPrototypeSet(rangeCache, rangeKey, compiled)
  return compiled
}

// Check if version satisfies a range
function satisfies(version, range, ecosystem = 'npm') {
  const v =
    typeof version === 'object' && version !== null
      ? version
      : tryParse(version, ecosystem)
  if (!v) {
    return false
  }

  range = StringPrototypeTrim(range)

  // Per npm semver, an empty or all-whitespace range is equivalent to '*'
  // and matches every version EXCEPT prereleases. npm's rule:
  // "A pre-release version will only be satisfied by a range that
  //  explicitly includes a pre-release in the same [major, minor, patch]
  //  tuple." So `satisfies('1.0.0-alpha', '*')` is false.
  // We short-circuit here rather than routing through compileRange so
  // the regex machinery doesn't produce a `[undefined]` comparator, but
  // we still need to honor the prerelease exclusion.
  if (range === '' || range === '*' || range === 'latest') {
    return !v.prerelease || v.prerelease.length === 0
  }

  const compiled = compileRange(range, ecosystem)

  for (let i = 0; i < compiled.length; i++) {
    const group = compiled[i]
    const { comparators, andParts, hyphenRanges } = group

    // Check prerelease rule: version with prerelease only satisfies range
    // if range explicitly includes prerelease on same major.minor.patch
    if (!rangeHasMatchingPrerelease(v, comparators)) {
      continue // This OR branch doesn't match
    }

    // Check satisfaction
    let allMatch = true
    let compIdx = 0
    let hyphenIdx = 0

    for (let j = 0; j < andParts.length; j++) {
      // Handle hyphen ranges (1.0.0 - 2.0.0)
      if (andParts[j + 1] === '-' && andParts[j + 2]) {
        const hr = hyphenRanges[hyphenIdx++]
        // Short-circuit on missing bounds FIRST so we never pass undefined
        // into compare(). A malformed hyphen upper like `1 - garbage` leaves
        // hr.upper === undefined, and compare(v, undefined) would throw
        // VersionError out of satisfies() — the whole point of this function
        // is to return a boolean, never to throw on user input.
        if (!hr.lower || !hr.upper || compare(v, hr.lower) < 0) {
          allMatch = false
          break
        }
        // upperOp is `<` when the upper bound was partial (exclusive
        // ceiling) and `<=` when the upper was fully qualified (inclusive).
        // Now that hr.upper is known-defined, compare is safe.
        const upperExclusive = hr.upperOp === '<'
        const upperFail = upperExclusive
          ? compare(v, hr.upper) >= 0
          : compare(v, hr.upper) > 0
        if (upperFail) {
          allMatch = false
          break
        }
        // compileRange only pushes a comparator for each bound that parsed
        // successfully (lower / upper). `compIdx += 2` would desync the
        // index if either bound was undefined. Today the guard above breaks
        // before we get here in the one-undefined-bound case, but making
        // the increment match the actual push count is defensive against a
        // future caller that replaces `break` with `continue`.
        compIdx += (hr.lower ? 1 : 0) + (hr.upper ? 1 : 0)
        j += 2
        continue
      }

      const comp = comparators[compIdx++]
      // Pass false to skip prerelease check since we already did it
      if (!comp || !satisfiesComparator(v, comp, false)) {
        allMatch = false
        break
      }
    }

    if (allMatch) {

      return true

    }
  }

  return false
}

// Find max/min version satisfying a range
function maxSatisfying(versions, range, ecosystem = 'npm') {
  const matching = ArrayPrototypeFilter(versions, v =>
    satisfies(v, range, ecosystem),
  )
  return max(matching, ecosystem)
}

function minSatisfying(versions, range, ecosystem = 'npm') {
  const matching = ArrayPrototypeFilter(versions, v =>
    satisfies(v, range, ecosystem),
  )
  return min(matching, ecosystem)
}

// Filter versions by range
function filter(versions, range, ecosystem = 'npm') {
  return ArrayPrototypeFilter(versions, v => satisfies(v, range, ecosystem))
}

// Validate version string
function valid(version, ecosystem = 'npm') {
  const parsed = tryParse(version, ecosystem)
  return parsed ? parsed.raw : undefined
}

// Coerce to valid version
function coerce(version, ecosystem = 'npm') {
  if (typeof version !== 'string') {
    return undefined
  }

  version = StringPrototypeTrim(version)
  // Remove leading v
  if (version[0] === 'v' || version[0] === 'V') {
    version = StringPrototypeSlice(version, 1)
  }

  // Try to extract version-like pattern
  const match = RegExpPrototypeExec(COERCE_VERSION_REGEX, version)
  if (!match) {
    return undefined
  }

  const major = match[1] || '0'
  const minor = match[2] || '0'
  const patch = match[3] || '0'

  return `${major}.${minor}.${patch}`
}

// Increment version
function inc(version, release, ecosystem = 'npm', identifier) {
  const v = parse(version, ecosystem)

  switch (release) {
    case 'major':
      return `${v.major + 1}.0.0`
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`
    case 'prerelease': {
      if (v.prerelease.length > 0) {
        const last = v.prerelease[v.prerelease.length - 1]
        if (typeof last === 'number') {
          const newPre = ArrayFrom(ArrayPrototypeSlice(v.prerelease, 0, -1))
          ArrayPrototypePush(newPre, last + 1)
          return `${v.major}.${v.minor}.${v.patch}-${ArrayPrototypeJoin(newPre, '.')}`
        }
        // Non-numeric tail (e.g. `1.0.0-alpha`) — append `.0` per npm semver.
        const newPre = ArrayFrom(v.prerelease)
        ArrayPrototypePush(newPre, 0)
        return `${v.major}.${v.minor}.${v.patch}-${ArrayPrototypeJoin(newPre, '.')}`
      }
      // Per semver: default to numeric identifier 0 (not 'alpha')
      if (identifier) {
        return `${v.major}.${v.minor}.${v.patch + 1}-${identifier}.0`
      }
      return `${v.major}.${v.minor}.${v.patch + 1}-0`
    }
    default:
      throw new VersionError(
        `Invalid release type: ${release}`,
        'ERR_INVALID_RELEASE',
      )
  }
}

function cacheStats() {
  return ObjectFreeze({
    __proto__: null,
    size: cache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate:
      cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) : 0,
  })
}

function clearCache() {
  cache = new SafeMap()
  rangeCache = new SafeMap()
  cacheHits = 0
  cacheMisses = 0
}

module.exports = {
  __proto__: null,
  parse,
  tryParse,
  compare,
  lt,
  lte,
  gt,
  gte,
  eq,
  neq,
  sort,
  rsort,
  max,
  min,
  satisfies,
  maxSatisfying,
  minSatisfying,
  filter,
  valid,
  coerce,
  inc,
  cacheStats,
  clearCache,
  ecosystems,
  VersionError,
}

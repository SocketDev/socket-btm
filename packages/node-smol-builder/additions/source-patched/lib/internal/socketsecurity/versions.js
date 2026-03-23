'use strict';

// Internal version parser and comparator
// Multi-ecosystem support: npm/SemVer, Maven, PyPI, etc.

const {
  ArrayFrom,
  ArrayPrototypeFilter,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  ArrayPrototypeSort,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeSet,
  NumberIsNaN,
  ObjectFreeze,
  RegExpPrototypeExec,
  RegExpPrototypeTest,
  SafeMap,
  StringPrototypeCharCodeAt,
  StringPrototypeIndexOf,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeToLowerCase,
  StringPrototypeTrim,
} = primordials;

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
});

class VersionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'VersionError';
    this.code = code;
  }
}

// LRU cache using SafeMap (insertion-ordered, O(1) eviction)
const CACHE_SIZE = 50000;
let cache = new SafeMap();
let cacheHits = 0;
let cacheMisses = 0;

// Range cache: stores compiled comparator arrays keyed by `${ecosystem}:${range}`
const RANGE_CACHE_SIZE = 10000;
let rangeCache = new SafeMap();

function cacheKey(version, eco) {
  return `${eco}:${version}`;
}

function cacheGet(key) {
  const value = MapPrototypeGet(cache, key);
  if (value !== undefined) {
    cacheHits++;
    return value;
  }
  cacheMisses++;
  return undefined;
}

function cachePut(key, value) {
  if (cache.size >= CACHE_SIZE) {
    // Evict oldest entry (first key in insertion order) — O(1)
    const oldest = cache.keys().next().value;
    MapPrototypeDelete(cache, oldest);
  }
  MapPrototypeSet(cache, key, value);
}

// Hand-rolled digit parsing — the regex guarantees pure digits,
// so we avoid NumberParseInt overhead with a simple charCode loop.
function parseDigits(str) {
  let n = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    n = n * 10 + (StringPrototypeCharCodeAt(str, i) - 48);
  }
  return n;
}

// SemVer regex (strict mode: requires major.minor.patch, no leading zeros)
// Per semver spec: numeric identifiers are "0|[1-9]\d*" (no leading zeros except standalone 0)
const SEMVER_REGEX = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

// Regex for numeric-only identifiers (per semver spec)
const NUMERIC_IDENTIFIER = /^[0-9]+$/;

// Parse prerelease identifiers
// Per semver spec: only convert to number if ENTIRE identifier is digits
function parsePrerelease(str) {
  if (!str) return [];
  const parts = StringPrototypeSplit(str, '.');
  return ArrayPrototypeMap(parts, (p) => {
    // Only convert to number if entire string is digits (per semver gold standard)
    if (RegExpPrototypeTest(NUMERIC_IDENTIFIER, p)) {
      const num = parseDigits(p);
      if (!NumberIsNaN(num)) {
        return num;
      }
    }
    return p;
  });
}

// Compute packed integer for fast comparison of versions without prerelease.
// major * 2^20 + minor * 2^10 + patch — safe for values up to ~1000 each.
function computePacked(major, minor, patch) {
  return major * 1048576 + minor * 1024 + patch;
}

// Parse npm/SemVer version
function parseNpm(version) {
  const match = RegExpPrototypeExec(SEMVER_REGEX, version);
  if (!match) {
    throw new VersionError(`Invalid npm version: ${version}`, 'ERR_INVALID_VERSION');
  }

  const major = parseDigits(match[1]);
  const minor = parseDigits(match[2]);
  const patch = parseDigits(match[3]);
  const prerelease = parsePrerelease(match[4]);

  return ObjectFreeze({
    __proto__: null,
    major,
    minor,
    patch,
    prerelease,
    buildMetadata: match[5] || undefined,
    raw: version,
    _packed: computePacked(major, minor, patch),
  });
}

// Parse Maven version
function parseMaven(version) {
  // Maven versions are more complex - simplified for now
  const parts = StringPrototypeSplit(version, /[.\-]/);
  const nums = [];
  let qualifier;

  for (let i = 0; i < parts.length; i++) {
    const num = parseDigits(parts[i]);
    if (NumberIsNaN(num)) {
      qualifier = StringPrototypeSlice(parts.join('.'), parts.slice(0, i).join('.').length + 1);
      break;
    }
    ArrayPrototypePush(nums, num);
  }

  const major = nums[0] || 0;
  const minor = nums[1] || 0;
  const patch = nums[2] || 0;

  return ObjectFreeze({
    __proto__: null,
    major,
    minor,
    patch,
    prerelease: qualifier ? [qualifier] : [],
    buildMetadata: undefined,
    raw: version,
    _packed: computePacked(major, minor, patch),
  });
}

// Parse PyPI PEP 440 version
function parsePypi(version) {
  // Handle epoch
  let epoch = 0;
  let rest = version;
  const bangIdx = StringPrototypeIndexOf(version, '!');
  if (bangIdx !== -1) {
    epoch = parseDigits(StringPrototypeSlice(version, 0, bangIdx)) || 0;
    rest = StringPrototypeSlice(version, bangIdx + 1);
  }

  // Parse release numbers
  const match = RegExpPrototypeExec(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(.*)$/, rest);
  if (!match) {
    throw new VersionError(`Invalid PyPI version: ${version}`, 'ERR_INVALID_VERSION');
  }

  const prerelease = [];
  const suffix = match[4] || '';

  // Parse pre/post/dev
  if (suffix) {
    const preMatch = RegExpPrototypeExec(/^[._-]?(a|alpha|b|beta|c|rc|pre|preview)\.?(\d+)?/i, suffix);
    if (preMatch) {
      ArrayPrototypePush(prerelease, StringPrototypeToLowerCase(preMatch[1]));
      if (preMatch[2]) ArrayPrototypePush(prerelease, parseDigits(preMatch[2]));
    }
  }

  const major = parseDigits(match[1]) || 0;
  const minor = match[2] ? parseDigits(match[2]) : 0;
  const patch = match[3] ? parseDigits(match[3]) : 0;

  return ObjectFreeze({
    __proto__: null,
    major,
    minor,
    patch,
    prerelease,
    buildMetadata: undefined,
    epoch,
    raw: version,
    _packed: computePacked(major, minor, patch),
  });
}

// Generic parser based on ecosystem
function parse(version, ecosystem = 'npm') {
  if (typeof version !== 'string') {
    throw new VersionError('Version must be a string', 'ERR_INVALID_TYPE');
  }

  version = StringPrototypeTrim(version);
  const key = cacheKey(version, ecosystem);
  const cached = cacheGet(key);
  if (cached) return cached;

  let result;
  switch (ecosystem) {
    case 'npm':
    case 'cargo':
      result = parseNpm(version);
      break;
    case 'maven':
      result = parseMaven(version);
      break;
    case 'pypi':
      result = parsePypi(version);
      break;
    default:
      result = parseNpm(version);
  }

  cachePut(key, result);
  return result;
}

function tryParse(version, ecosystem = 'npm') {
  try {
    return parse(version, ecosystem);
  } catch {
    return undefined;
  }
}

// Compare prerelease arrays
function comparePrerelease(a, b) {
  // No prerelease > has prerelease
  if (a.length === 0 && b.length > 0) return 1;
  if (a.length > 0 && b.length === 0) return -1;
  if (a.length === 0 && b.length === 0) return 0;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const aVal = a[i];
    const bVal = b[i];

    // Missing < existing
    if (aVal === undefined) return -1;
    if (bVal === undefined) return 1;

    // Number < string
    const aNum = typeof aVal === 'number';
    const bNum = typeof bVal === 'number';

    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;

    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
  }

  return 0;
}

// Compare two versions
function compare(a, b, ecosystem = 'npm') {
  const va = typeof a === 'object' ? a : parse(a, ecosystem);
  const vb = typeof b === 'object' ? b : parse(b, ecosystem);

  // Packed integer fast path: single compare when both have no prerelease
  if (va.prerelease.length === 0 && vb.prerelease.length === 0) {
    if (va._packed !== vb._packed) return va._packed < vb._packed ? -1 : 1;
    return 0;
  }

  // Compare major.minor.patch
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;

  // Compare prerelease
  return comparePrerelease(va.prerelease, vb.prerelease);
}

// Comparison helpers
function lt(a, b, eco) { return compare(a, b, eco) < 0; }
function lte(a, b, eco) { return compare(a, b, eco) <= 0; }
function gt(a, b, eco) { return compare(a, b, eco) > 0; }
function gte(a, b, eco) { return compare(a, b, eco) >= 0; }
function eq(a, b, eco) { return compare(a, b, eco) === 0; }
function neq(a, b, eco) { return compare(a, b, eco) !== 0; }

// Sort versions — pre-parse all versions once (O(n)), then sort pre-parsed values
function sort(versions, ecosystem = 'npm', descending = false) {
  const arr = ArrayFrom(versions);
  // Pre-parse all versions to avoid repeated parsing in comparator
  const parsed = ArrayPrototypeMap(arr, (v) =>
    typeof v === 'object' ? v : parse(v, ecosystem)
  );
  // Create index array to track original positions
  const indices = ArrayFrom({ length: arr.length }, (_, i) => i);
  ArrayPrototypeSort(indices, (ai, bi) => {
    const va = parsed[ai];
    const vb = parsed[bi];
    // Packed integer fast path
    if (va.prerelease.length === 0 && vb.prerelease.length === 0) {
      if (va._packed !== vb._packed) return va._packed < vb._packed ? -1 : 1;
      return 0;
    }
    if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
    if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
    if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
    return comparePrerelease(va.prerelease, vb.prerelease);
  });
  const sorted = ArrayPrototypeMap(indices, (i) => arr[i]);
  return descending ? sorted.reverse() : sorted;
}

function rsort(versions, ecosystem = 'npm') {
  return sort(versions, ecosystem, true);
}

// Find max version — O(n) linear scan instead of O(n log n) sort
function max(versions, ecosystem = 'npm') {
  if (!versions || versions.length === 0) return undefined;
  let best = versions[0];
  for (let i = 1, len = versions.length; i < len; i++) {
    if (compare(versions[i], best, ecosystem) > 0) {
      best = versions[i];
    }
  }
  return best;
}

// Find min version — O(n) linear scan instead of O(n log n) sort
function min(versions, ecosystem = 'npm') {
  if (!versions || versions.length === 0) return undefined;
  let best = versions[0];
  for (let i = 1, len = versions.length; i < len; i++) {
    if (compare(versions[i], best, ecosystem) < 0) {
      best = versions[i];
    }
  }
  return best;
}

// Parse a range comparator (e.g., ">=1.0.0", "^2.0.0")
function parseComparator(comp, ecosystem) {
  comp = StringPrototypeTrim(comp);
  if (!comp) return undefined;

  // Standalone wildcard * matches anything
  if (comp === '*' || comp === 'x' || comp === 'X') {
    return { __proto__: null, op: '*', major: undefined, minor: undefined, patch: undefined };
  }

  // Exact match
  if (/^\d/.test(comp)) {
    const v = tryParse(comp, ecosystem);
    if (v) return { __proto__: null, op: '=', version: v };
  }

  // Operators: >=, <=, >, <, =
  const opMatch = RegExpPrototypeExec(/^(>=|<=|>|<|=)\s*(.+)$/, comp);
  if (opMatch) {
    const v = tryParse(opMatch[2], ecosystem);
    if (v) return { __proto__: null, op: opMatch[1], version: v };
  }

  // Caret ^
  const caretMatch = RegExpPrototypeExec(/^\^(.+)$/, comp);
  if (caretMatch) {
    const v = tryParse(caretMatch[1], ecosystem);
    if (v) return { __proto__: null, op: '^', version: v };
  }

  // Tilde ~
  const tildeMatch = RegExpPrototypeExec(/^~(.+)$/, comp);
  if (tildeMatch) {
    const v = tryParse(tildeMatch[1], ecosystem);
    if (v) return { __proto__: null, op: '~', version: v };
  }

  // Wildcard x, X, * with versions (e.g., 1.x, 1.2.*)
  const wildMatch = RegExpPrototypeExec(/^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/, comp);
  if (wildMatch) {
    return {
      __proto__: null,
      op: '*',
      major: parseDigits(wildMatch[1]) || 0,
      minor: wildMatch[2] && !/[xX*]/.test(wildMatch[2]) ? parseDigits(wildMatch[2]) : undefined,
      patch: wildMatch[3] && !/[xX*]/.test(wildMatch[3]) ? parseDigits(wildMatch[3]) : undefined,
    };
  }

  return undefined;
}

// Check if prerelease version is allowed for this comparator
// Per semver spec: prerelease versions only satisfy ranges that explicitly
// include prerelease tags on the same [major, minor, patch] tuple
function prereleaseAllowed(version, comp) {
  // If version has no prerelease, it's always allowed
  if (!version.prerelease || version.prerelease.length === 0) {
    return true;
  }

  // If comparator's version has prerelease on same tuple, allow it
  if (comp.version && comp.version.prerelease && comp.version.prerelease.length > 0) {
    // Check if same major.minor.patch
    if (version.major === comp.version.major &&
        version.minor === comp.version.minor &&
        version.patch === comp.version.patch) {
      return true;
    }
  }

  // Prerelease versions don't satisfy non-prerelease ranges
  return false;
}

// Check if version satisfies a comparator
function satisfiesComparator(version, comp, checkPrerelease = true) {
  const v = typeof version === 'object' ? version : parse(version);

  // Per semver spec: prerelease versions only match ranges that explicitly
  // include prerelease tags on the same [major, minor, patch] tuple
  if (checkPrerelease && !prereleaseAllowed(v, comp)) {
    return false;
  }

  switch (comp.op) {
    case '=':
      return compare(v, comp.version) === 0;
    case '>':
      return compare(v, comp.version) > 0;
    case '>=':
      return compare(v, comp.version) >= 0;
    case '<':
      return compare(v, comp.version) < 0;
    case '<=':
      return compare(v, comp.version) <= 0;
    case '^': {
      // ^1.2.3 := >=1.2.3 <2.0.0 (for major > 0)
      // ^0.2.3 := >=0.2.3 <0.3.0 (for major = 0, minor > 0)
      // ^0.0.3 := >=0.0.3 <0.0.4 (for major = 0, minor = 0)
      const cv = comp.version;
      if (compare(v, cv) < 0) return false;

      if (cv.major > 0) {
        return v.major === cv.major;
      } else if (cv.minor > 0) {
        return v.major === 0 && v.minor === cv.minor;
      } else {
        return v.major === 0 && v.minor === 0 && v.patch === cv.patch;
      }
    }
    case '~': {
      // ~1.2.3 := >=1.2.3 <1.3.0
      const cv = comp.version;
      if (compare(v, cv) < 0) return false;
      return v.major === cv.major && v.minor === cv.minor;
    }
    case '*': {
      // Wildcard matching
      if (comp.major !== undefined && v.major !== comp.major) return false;
      if (comp.minor !== undefined && v.minor !== comp.minor) return false;
      if (comp.patch !== undefined && v.patch !== comp.patch) return false;
      return true;
    }
    default:
      return false;
  }
}

// Check if any comparator in a range set explicitly includes prerelease
// on the same [major, minor, patch] tuple as the version
function rangeHasMatchingPrerelease(version, comparators) {
  if (!version.prerelease || version.prerelease.length === 0) {
    return true; // No prerelease on version, always OK
  }

  for (const comp of comparators) {
    if (comp && comp.version && comp.version.prerelease && comp.version.prerelease.length > 0) {
      // Check if same major.minor.patch
      if (version.major === comp.version.major &&
          version.minor === comp.version.minor &&
          version.patch === comp.version.patch) {
        return true;
      }
    }
  }

  return false;
}

// Compile a range string into an array of OR-groups, each containing
// { comparators, andParts (for hyphen re-check) }
function compileRange(range, ecosystem) {
  const rangeKey = `${ecosystem}:${range}`;
  const cached = MapPrototypeGet(rangeCache, rangeKey);
  if (cached !== undefined) return cached;

  const orParts = StringPrototypeSplit(range, /\s*\|\|\s*/);
  const compiled = [];

  for (let i = 0; i < orParts.length; i++) {
    const andParts = StringPrototypeSplit(orParts[i], /\s+/);
    const comparators = [];
    // Track hyphen ranges separately for the satisfaction pass
    const hyphenRanges = [];

    for (let j = 0; j < andParts.length; j++) {
      if (andParts[j + 1] === '-' && andParts[j + 2]) {
        const lower = tryParse(andParts[j], ecosystem);
        const upper = tryParse(andParts[j + 2], ecosystem);
        if (lower) ArrayPrototypePush(comparators, { __proto__: null, op: '>=', version: lower });
        if (upper) ArrayPrototypePush(comparators, { __proto__: null, op: '<=', version: upper });
        ArrayPrototypePush(hyphenRanges, { __proto__: null, lower, upper });
        j += 2;
      } else {
        const comp = parseComparator(andParts[j], ecosystem);
        if (comp) ArrayPrototypePush(comparators, comp);
        else ArrayPrototypePush(comparators, undefined);
      }
    }

    ArrayPrototypePush(compiled, {
      __proto__: null,
      comparators,
      andParts,
      hyphenRanges,
    });
  }

  // Evict oldest if range cache is full
  if (rangeCache.size >= RANGE_CACHE_SIZE) {
    const oldest = rangeCache.keys().next().value;
    MapPrototypeDelete(rangeCache, oldest);
  }
  MapPrototypeSet(rangeCache, rangeKey, compiled);
  return compiled;
}

// Check if version satisfies a range
function satisfies(version, range, ecosystem = 'npm') {
  const v = typeof version === 'object' ? version : tryParse(version, ecosystem);
  if (!v) return false;

  range = StringPrototypeTrim(range);

  const compiled = compileRange(range, ecosystem);

  for (let i = 0; i < compiled.length; i++) {
    const group = compiled[i];
    const { comparators, andParts, hyphenRanges } = group;

    // Check prerelease rule: version with prerelease only satisfies range
    // if range explicitly includes prerelease on same major.minor.patch
    if (!rangeHasMatchingPrerelease(v, comparators)) {
      continue; // This OR branch doesn't match
    }

    // Check satisfaction
    let allMatch = true;
    let compIdx = 0;
    let hyphenIdx = 0;

    for (let j = 0; j < andParts.length; j++) {
      // Handle hyphen ranges (1.0.0 - 2.0.0)
      if (andParts[j + 1] === '-' && andParts[j + 2]) {
        const hr = hyphenRanges[hyphenIdx++];
        if (!hr.lower || !hr.upper || compare(v, hr.lower) < 0 || compare(v, hr.upper) > 0) {
          allMatch = false;
          break;
        }
        compIdx += 2; // Skip the two comparators we added for this hyphen range
        j += 2;
        continue;
      }

      const comp = comparators[compIdx++];
      // Pass false to skip prerelease check since we already did it
      if (!comp || !satisfiesComparator(v, comp, false)) {
        allMatch = false;
        break;
      }
    }

    if (allMatch) return true;
  }

  return false;
}

// Find max/min version satisfying a range
function maxSatisfying(versions, range, ecosystem = 'npm') {
  const matching = ArrayPrototypeFilter(versions, (v) => satisfies(v, range, ecosystem));
  return max(matching, ecosystem);
}

function minSatisfying(versions, range, ecosystem = 'npm') {
  const matching = ArrayPrototypeFilter(versions, (v) => satisfies(v, range, ecosystem));
  return min(matching, ecosystem);
}

// Filter versions by range
function filter(versions, range, ecosystem = 'npm') {
  return ArrayPrototypeFilter(versions, (v) => satisfies(v, range, ecosystem));
}

// Validate version string
function valid(version, ecosystem = 'npm') {
  const parsed = tryParse(version, ecosystem);
  return parsed ? parsed.raw : undefined;
}

// Coerce to valid version
function coerce(version, ecosystem = 'npm') {
  if (typeof version !== 'string') return undefined;

  version = StringPrototypeTrim(version);
  // Remove leading v
  if (version[0] === 'v' || version[0] === 'V') {
    version = StringPrototypeSlice(version, 1);
  }

  // Try to extract version-like pattern
  const match = RegExpPrototypeExec(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/, version);
  if (!match) return undefined;

  const major = match[1] || '0';
  const minor = match[2] || '0';
  const patch = match[3] || '0';

  return `${major}.${minor}.${patch}`;
}

// Increment version
function inc(version, release, ecosystem = 'npm', identifier) {
  const v = parse(version, ecosystem);

  switch (release) {
    case 'major':
      return `${v.major + 1}.0.0`;
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`;
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`;
    case 'prerelease': {
      if (v.prerelease.length > 0) {
        const last = v.prerelease[v.prerelease.length - 1];
        if (typeof last === 'number') {
          const newPre = ArrayFrom(ArrayPrototypeSlice(v.prerelease, 0, -1));
          ArrayPrototypePush(newPre, last + 1);
          return `${v.major}.${v.minor}.${v.patch}-${newPre.join('.')}`;
        }
      }
      // Per semver: default to numeric identifier 0 (not 'alpha')
      if (identifier) {
        return `${v.major}.${v.minor}.${v.patch + 1}-${identifier}.0`;
      }
      return `${v.major}.${v.minor}.${v.patch + 1}-0`;
    }
    default:
      throw new VersionError(`Invalid release type: ${release}`, 'ERR_INVALID_RELEASE');
  }
}

function cacheStats() {
  return ObjectFreeze({
    __proto__: null,
    size: cache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: (cacheHits + cacheMisses) > 0 ? cacheHits / (cacheHits + cacheMisses) : 0,
  });
}

function clearCache() {
  cache = new SafeMap();
  rangeCache = new SafeMap();
  cacheHits = 0;
  cacheMisses = 0;
}

module.exports = {
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
};

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
  NumberIsNaN,
  NumberParseInt,
  ObjectFreeze,
  RegExpPrototypeExec,
  RegExpPrototypeTest,
  StringPrototypeCharCodeAt,
  StringPrototypeIndexOf,
  StringPrototypeMatch,
  StringPrototypeReplace,
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

// Simple cache
const CACHE_SIZE = 50000;
let cache = { __proto__: null };
let cacheOrder = [];
let cacheHits = 0;
let cacheMisses = 0;

function cacheKey(version, eco) {
  return `${eco}:${version}`;
}

function cacheGet(key) {
  if (cache[key]) {
    cacheHits++;
    return cache[key];
  }
  cacheMisses++;
  return null;
}

function cachePut(key, value) {
  if (cacheOrder.length >= CACHE_SIZE) {
    const oldest = cacheOrder.shift();
    delete cache[oldest];
  }
  cache[key] = value;
  ArrayPrototypePush(cacheOrder, key);
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
      const num = NumberParseInt(p, 10);
      if (!NumberIsNaN(num)) {
        return num;
      }
    }
    return p;
  });
}

// Parse npm/SemVer version
function parseNpm(version) {
  const match = RegExpPrototypeExec(SEMVER_REGEX, version);
  if (!match) {
    throw new VersionError(`Invalid npm version: ${version}`, 'ERR_INVALID_VERSION');
  }

  return ObjectFreeze({
    __proto__: null,
    major: NumberParseInt(match[1], 10),
    minor: NumberParseInt(match[2], 10),
    patch: NumberParseInt(match[3], 10),
    prerelease: parsePrerelease(match[4]),
    buildMetadata: match[5] || null,
    raw: version,
  });
}

// Parse Maven version
function parseMaven(version) {
  // Maven versions are more complex - simplified for now
  const parts = StringPrototypeSplit(version, /[.\-]/);
  const nums = [];
  let qualifier = null;

  for (let i = 0; i < parts.length; i++) {
    const num = NumberParseInt(parts[i], 10);
    if (NumberIsNaN(num)) {
      qualifier = StringPrototypeSlice(parts.join('.'), parts.slice(0, i).join('.').length + 1);
      break;
    }
    ArrayPrototypePush(nums, num);
  }

  return ObjectFreeze({
    __proto__: null,
    major: nums[0] || 0,
    minor: nums[1] || 0,
    patch: nums[2] || 0,
    prerelease: qualifier ? [qualifier] : [],
    buildMetadata: null,
    raw: version,
  });
}

// Parse PyPI PEP 440 version
function parsePypi(version) {
  // Handle epoch
  let epoch = 0;
  let rest = version;
  const bangIdx = StringPrototypeIndexOf(version, '!');
  if (bangIdx !== -1) {
    epoch = NumberParseInt(StringPrototypeSlice(version, 0, bangIdx), 10) || 0;
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
      if (preMatch[2]) ArrayPrototypePush(prerelease, NumberParseInt(preMatch[2], 10));
    }
  }

  return ObjectFreeze({
    __proto__: null,
    major: NumberParseInt(match[1], 10) || 0,
    minor: NumberParseInt(match[2], 10) || 0,
    patch: NumberParseInt(match[3], 10) || 0,
    prerelease,
    buildMetadata: null,
    epoch,
    raw: version,
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
    return null;
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

// Sort versions
function sort(versions, ecosystem = 'npm', descending = false) {
  const sorted = ArrayPrototypeSort(ArrayFrom(versions), (a, b) => compare(a, b, ecosystem));
  return descending ? sorted.reverse() : sorted;
}

function rsort(versions, ecosystem = 'npm') {
  return sort(versions, ecosystem, true);
}

// Find max/min
function max(versions, ecosystem = 'npm') {
  if (!versions || versions.length === 0) return null;
  return sort(versions, ecosystem, true)[0];
}

function min(versions, ecosystem = 'npm') {
  if (!versions || versions.length === 0) return null;
  return sort(versions, ecosystem)[0];
}

// Parse a range comparator (e.g., ">=1.0.0", "^2.0.0")
function parseComparator(comp, ecosystem) {
  comp = StringPrototypeTrim(comp);
  if (!comp) return null;

  // Standalone wildcard * matches anything
  if (comp === '*' || comp === 'x' || comp === 'X') {
    return { op: '*', major: null, minor: null, patch: null };
  }

  // Exact match
  if (/^\d/.test(comp)) {
    const v = tryParse(comp, ecosystem);
    if (v) return { op: '=', version: v };
  }

  // Operators: >=, <=, >, <, =
  const opMatch = RegExpPrototypeExec(/^(>=|<=|>|<|=)\s*(.+)$/, comp);
  if (opMatch) {
    const v = tryParse(opMatch[2], ecosystem);
    if (v) return { op: opMatch[1], version: v };
  }

  // Caret ^
  const caretMatch = RegExpPrototypeExec(/^\^(.+)$/, comp);
  if (caretMatch) {
    const v = tryParse(caretMatch[1], ecosystem);
    if (v) return { op: '^', version: v };
  }

  // Tilde ~
  const tildeMatch = RegExpPrototypeExec(/^~(.+)$/, comp);
  if (tildeMatch) {
    const v = tryParse(tildeMatch[1], ecosystem);
    if (v) return { op: '~', version: v };
  }

  // Wildcard x, X, * with versions (e.g., 1.x, 1.2.*)
  const wildMatch = RegExpPrototypeExec(/^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/, comp);
  if (wildMatch) {
    return {
      op: '*',
      major: NumberParseInt(wildMatch[1], 10) || 0,
      minor: wildMatch[2] && !/[xX*]/.test(wildMatch[2]) ? NumberParseInt(wildMatch[2], 10) : null,
      patch: wildMatch[3] && !/[xX*]/.test(wildMatch[3]) ? NumberParseInt(wildMatch[3], 10) : null,
    };
  }

  return null;
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
      if (comp.major !== null && v.major !== comp.major) return false;
      if (comp.minor !== null && v.minor !== comp.minor) return false;
      if (comp.patch !== null && v.patch !== comp.patch) return false;
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

// Check if version satisfies a range
function satisfies(version, range, ecosystem = 'npm') {
  const v = typeof version === 'object' ? version : tryParse(version, ecosystem);
  if (!v) return false;

  range = StringPrototypeTrim(range);

  // Handle || (OR)
  const orParts = StringPrototypeSplit(range, /\s*\|\|\s*/);
  for (let i = 0; i < orParts.length; i++) {
    // Handle space-separated (AND)
    const andParts = StringPrototypeSplit(orParts[i], /\s+/);
    let allMatch = true;

    // First pass: collect all comparators to check prerelease rules
    const comparators = [];
    for (let j = 0; j < andParts.length; j++) {
      if (andParts[j + 1] === '-' && andParts[j + 2]) {
        // Hyphen range - add lower and upper bounds
        const lower = tryParse(andParts[j], ecosystem);
        const upper = tryParse(andParts[j + 2], ecosystem);
        if (lower) comparators.push({ op: '>=', version: lower });
        if (upper) comparators.push({ op: '<=', version: upper });
        j += 2;
      } else {
        const comp = parseComparator(andParts[j], ecosystem);
        if (comp) comparators.push(comp);
      }
    }

    // Check prerelease rule: version with prerelease only satisfies range
    // if range explicitly includes prerelease on same major.minor.patch
    if (!rangeHasMatchingPrerelease(v, comparators)) {
      continue; // This OR branch doesn't match
    }

    // Second pass: actually check satisfaction (skip prerelease check since we did it above)
    for (let j = 0; j < andParts.length; j++) {
      // Handle hyphen ranges (1.0.0 - 2.0.0)
      if (andParts[j + 1] === '-' && andParts[j + 2]) {
        const lower = tryParse(andParts[j], ecosystem);
        const upper = tryParse(andParts[j + 2], ecosystem);
        if (!lower || !upper || compare(v, lower) < 0 || compare(v, upper) > 0) {
          allMatch = false;
          break;
        }
        j += 2;
        continue;
      }

      const comp = parseComparator(andParts[j], ecosystem);
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
  return parsed ? parsed.raw : null;
}

// Coerce to valid version
function coerce(version, ecosystem = 'npm') {
  if (typeof version !== 'string') return null;

  version = StringPrototypeTrim(version);
  // Remove leading v
  if (version[0] === 'v' || version[0] === 'V') {
    version = StringPrototypeSlice(version, 1);
  }

  // Try to extract version-like pattern
  const match = RegExpPrototypeExec(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/, version);
  if (!match) return null;

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
  const total = cacheHits + cacheMisses;
  return ObjectFreeze({
    __proto__: null,
    size: cacheOrder.length,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total > 0 ? cacheHits / total : 0,
  });
}

function clearCache() {
  cache = { __proto__: null };
  cacheOrder = [];
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

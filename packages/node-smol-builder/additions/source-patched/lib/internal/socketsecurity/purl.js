'use strict';

// Internal PURL parser implementation
// High-performance Package URL parsing per the PURL spec
// Aligned with socket-packageurl-js gold standard

const {
  ArrayFrom,
  ArrayPrototypeFilter,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypeSort,
  decodeURIComponent,
  encodeURIComponent,
  ObjectEntries,
  ObjectFreeze,
  ObjectKeys,
  String: StringCtor,
  StringPrototypeCharCodeAt,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
  StringPrototypeReplaceAll,
  StringPrototypeTrim,
} = primordials;

// PURL type constants
const types = ObjectFreeze({
  __proto__: null,
  NPM: 'npm',
  MAVEN: 'maven',
  PYPI: 'pypi',
  NUGET: 'nuget',
  GEM: 'gem',
  CARGO: 'cargo',
  GOLANG: 'golang',
  COMPOSER: 'composer',
  CONAN: 'conan',
  CONDA: 'conda',
  CRAN: 'cran',
  DEB: 'deb',
  DOCKER: 'docker',
  GENERIC: 'generic',
  GITHUB: 'github',
  HACKAGE: 'hackage',
  HEX: 'hex',
  MLFLOW: 'mlflow',
  OCI: 'oci',
  PUB: 'pub',
  RPM: 'rpm',
  SWID: 'swid',
  SWIFT: 'swift',
});

// Max PURL length to prevent DoS
const MAX_PURL_LENGTH = 4096;

class PurlError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PurlError';
    this.code = code;
  }
}

// Simple LRU cache
const CACHE_SIZE = 10000;
let cache = { __proto__: null };
let cacheOrder = [];
let cacheHits = 0;
let cacheMisses = 0;

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

// URL decode - per PURL spec
function urlDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

// Decode qualifier value - per PURL spec, + is preserved as literal (NOT space)
// This differs from application/x-www-form-urlencoded
function decodeQualifierValue(str) {
  try {
    // Per gold standard: just use decodeURIComponent, preserve + as literal
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

// URL encode - per PURL spec
function urlEncode(str) {
  return encodeURIComponent(str);
}

// Encode name - allow colons unescaped
function encodeName(str) {
  return StringPrototypeReplaceAll(encodeURIComponent(str), '%3A', ':');
}

// Encode namespace - allow colons and slashes unescaped (for golang, etc.)
function encodeNamespace(str) {
  let encoded = encodeURIComponent(str);
  encoded = StringPrototypeReplaceAll(encoded, '%3A', ':');
  encoded = StringPrototypeReplaceAll(encoded, '%2F', '/');
  return encoded;
}

// Encode version - allow colons unescaped
function encodeVersion(str) {
  return StringPrototypeReplaceAll(encodeURIComponent(str), '%3A', ':');
}

// Encode subpath - allow slashes unescaped
function encodeSubpath(str) {
  return StringPrototypeReplaceAll(encodeURIComponent(str), '%2F', '/');
}

// Encode qualifier value - per PURL spec (spaces → %20, + → %2B)
function encodeQualifierValue(str) {
  // Replace spaces with %20 so they don't become +
  const prepared = StringPrototypeReplaceAll(str, ' ', '%20');
  const encoded = encodeURIComponent(prepared);
  // URLSearchParams would encode %20 to %2520 and space to +, we want %20 for spaces
  // Also ensure + signs are encoded as %2B
  let result = StringPrototypeReplaceAll(encoded, '%2520', '%20');
  result = StringPrototypeReplaceAll(result, '+', '%2B');
  return result;
}

// Trim leading slashes (pkg:// should be treated as pkg:)
function trimLeadingSlashes(str) {
  let i = 0;
  while (i < str.length && str[i] === '/') i++;
  return i > 0 ? StringPrototypeSlice(str, i) : str;
}

// Collapse multiple consecutive slashes to single slash
// Per PURL spec and gold standard: foo//bar -> foo/bar
function collapseSlashes(str) {
  // Fast path: no double slashes
  if (StringPrototypeIndexOf(str, '//') === -1) return str;
  // Replace all occurrences of multiple slashes with single slash
  let result = str;
  while (StringPrototypeIndexOf(result, '//') !== -1) {
    result = StringPrototypeReplaceAll(result, '//', '/');
  }
  return result;
}

// Filter subpath segments - remove . and .. per PURL spec
function filterSubpathSegments(subpath) {
  if (!subpath) return null;
  const segments = StringPrototypeSplit(subpath, '/');
  const filtered = ArrayPrototypeFilter(segments, (seg) => {
    // Remove empty segments, '.', and '..'
    return seg && seg !== '.' && seg !== '..';
  });
  if (filtered.length === 0) return null;
  return ArrayPrototypeJoin(filtered, '/');
}

// Parse a PURL string
function parse(purl) {
  if (typeof purl !== 'string') {
    throw new PurlError('PURL must be a string', 'ERR_INVALID_TYPE');
  }

  // Length validation to prevent DoS
  if (purl.length > MAX_PURL_LENGTH) {
    throw new PurlError(`PURL exceeds maximum length of ${MAX_PURL_LENGTH}`, 'ERR_TOO_LONG');
  }

  // Check cache
  const cached = cacheGet(purl);
  if (cached) return cached;

  // Handle pkg:// (ignore double slashes per spec)
  // Case-insensitive scheme check per gold standard (PkG: is valid)
  let rest;
  const scheme = StringPrototypeToLowerCase(StringPrototypeSlice(purl, 0, 4));
  if (scheme === 'pkg:') {
    rest = trimLeadingSlashes(StringPrototypeSlice(purl, 4));
  } else {
    throw new PurlError('PURL must start with "pkg:"', 'ERR_INVALID_PREFIX');
  }

  // Extract subpath (#subpath)
  let subpath = null;
  const hashIdx = StringPrototypeIndexOf(rest, '#');
  if (hashIdx !== -1) {
    const rawSubpath = urlDecode(StringPrototypeSlice(rest, hashIdx + 1));
    // Filter subpath segments per PURL spec (remove . and ..)
    subpath = filterSubpathSegments(rawSubpath);
    rest = StringPrototypeSlice(rest, 0, hashIdx);
  }

  // Extract qualifiers (?key=value&key2=value2)
  let qualifiers = null;
  const queryIdx = StringPrototypeIndexOf(rest, '?');
  if (queryIdx !== -1) {
    const queryStr = StringPrototypeSlice(rest, queryIdx + 1);
    rest = StringPrototypeSlice(rest, 0, queryIdx);
    qualifiers = { __proto__: null };
    const pairs = StringPrototypeSplit(queryStr, '&');
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (!pair) continue; // Skip empty pairs
      const eqIdx = StringPrototypeIndexOf(pair, '=');
      if (eqIdx !== -1) {
        // Decode and trim key, then lowercase per spec
        const rawKey = urlDecode(StringPrototypeSlice(pair, 0, eqIdx));
        const trimmedKey = StringPrototypeTrim(rawKey);
        const key = StringPrototypeToLowerCase(trimmedKey);
        if (!key) {
          throw new PurlError('qualifier key must not be empty', 'ERR_INVALID_QUALIFIER');
        }
        // Decode value, then trim (per gold standard order)
        const decodedValue = decodeQualifierValue(StringPrototypeSlice(pair, eqIdx + 1));
        const value = StringPrototypeTrim(decodedValue);
        // Skip empty values after trimming (per gold standard)
        if (value) {
          qualifiers[key] = value;
        }
      }
    }
    ObjectFreeze(qualifiers);
  }

  // Extract type (before first /)
  const slashIdx = StringPrototypeIndexOf(rest, '/');
  if (slashIdx === -1) {
    throw new PurlError('PURL must have a type and name', 'ERR_INVALID_FORMAT');
  }

  const type = StringPrototypeToLowerCase(urlDecode(StringPrototypeSlice(rest, 0, slashIdx)));
  rest = StringPrototypeSlice(rest, slashIdx + 1);

  // For npm type, handle special version parsing for pnpm peer dep syntax
  // e.g., pkg:npm/next@14.2.10(react-dom@18.3.1(react@18.3.1))
  let version = null;
  let atIdx;
  if (type === 'npm') {
    // For npm, find the first @ after any leading @scope/
    const startPos = rest[0] === '@' ? StringPrototypeIndexOf(rest, '/') + 1 : 0;
    atIdx = startPos > 0 ? StringPrototypeIndexOf(rest, '@', startPos) : StringPrototypeIndexOf(rest, '@');
  } else {
    // For other types, use lastIndexOf to handle @ in version strings
    atIdx = StringPrototypeLastIndexOf(rest, '@');
  }

  // When @ directly follows /, it's a scoped package marker not version separator
  if (atIdx > 0 && rest[atIdx - 1] === '/') {
    atIdx = -1;
  }

  if (atIdx !== -1 && atIdx > 0) {
    // Trim version whitespace per gold standard
    version = StringPrototypeTrim(urlDecode(StringPrototypeSlice(rest, atIdx + 1)));
    rest = StringPrototypeSlice(rest, 0, atIdx);
  }

  // Collapse multiple slashes before extracting namespace/name
  rest = collapseSlashes(rest);

  // Extract namespace and name
  let namespace = null;
  let name;
  const lastSlashIdx = StringPrototypeLastIndexOf(rest, '/');
  if (lastSlashIdx !== -1) {
    // Trim namespace and name whitespace per gold standard
    namespace = StringPrototypeTrim(urlDecode(StringPrototypeSlice(rest, 0, lastSlashIdx)));
    name = StringPrototypeTrim(urlDecode(StringPrototypeSlice(rest, lastSlashIdx + 1)));
  } else {
    name = StringPrototypeTrim(urlDecode(rest));
  }

  if (!name) {
    throw new PurlError('PURL must have a name', 'ERR_MISSING_NAME');
  }

  // Type-specific normalization
  let normalizedNamespace = namespace;
  let normalizedName = name;

  if (type === 'npm') {
    // npm: lowercase namespace and name (except legacy names)
    if (normalizedNamespace) {
      normalizedNamespace = StringPrototypeToLowerCase(normalizedNamespace);
    }
    normalizedName = StringPrototypeToLowerCase(normalizedName);
  } else if (type === 'pypi') {
    // pypi: lowercase and replace underscores/periods with hyphens
    normalizedName = StringPrototypeToLowerCase(normalizedName);
    // Replace underscores with dashes
    let result = '';
    let fromIndex = 0;
    let index = 0;
    while ((index = StringPrototypeIndexOf(normalizedName, '_', fromIndex)) !== -1) {
      result = `${result + StringPrototypeSlice(normalizedName, fromIndex, index)}-`;
      fromIndex = index + 1;
    }
    normalizedName = fromIndex ? result + StringPrototypeSlice(normalizedName, fromIndex) : normalizedName;
    // Replace periods with dashes (per gold standard)
    result = '';
    fromIndex = 0;
    while ((index = StringPrototypeIndexOf(normalizedName, '.', fromIndex)) !== -1) {
      result = `${result + StringPrototypeSlice(normalizedName, fromIndex, index)}-`;
      fromIndex = index + 1;
    }
    normalizedName = fromIndex ? result + StringPrototypeSlice(normalizedName, fromIndex) : normalizedName;
  }

  const result = ObjectFreeze({
    __proto__: null,
    type,
    namespace: normalizedNamespace,
    name: normalizedName,
    version,
    qualifiers,
    subpath,
  });

  cachePut(purl, result);
  return result;
}

// Try to parse, returns null on failure
function tryParse(purl) {
  try {
    return parse(purl);
  } catch {
    return null;
  }
}

// Parse multiple PURLs
function parseBatch(purls) {
  if (!Array.isArray(purls)) {
    throw new PurlError('parseBatch requires an array', 'ERR_INVALID_TYPE');
  }
  return ArrayPrototypeMap(purls, (p) => tryParse(p));
}

// Build a PURL string from components
function build(options) {
  if (!options || typeof options !== 'object') {
    throw new PurlError('build requires an options object', 'ERR_INVALID_TYPE');
  }

  const { type, namespace, name, version, qualifiers, subpath } = options;

  if (!type) {
    throw new PurlError('type is required', 'ERR_MISSING_TYPE');
  }
  if (!name) {
    throw new PurlError('name is required', 'ERR_MISSING_NAME');
  }

  const normalizedType = StringPrototypeToLowerCase(type);
  let purl = `pkg:${normalizedType}/`;

  if (namespace) {
    // Use encodeNamespace to preserve slashes for golang, etc.
    purl += `${encodeNamespace(namespace)}/`;
  }

  // Use encodeName to allow colons
  purl += encodeName(name);

  if (version) {
    // Use encodeVersion to allow colons
    purl += `@${encodeVersion(version)}`;
  }

  if (qualifiers && ObjectKeys(qualifiers).length > 0) {
    // Sort qualifier keys lexicographically per spec
    const sortedKeys = ArrayPrototypeSort(ArrayFrom(ObjectKeys(qualifiers)));
    const pairs = ArrayPrototypeMap(sortedKeys, (k) => {
      const value = qualifiers[k];
      // Skip null/undefined values
      if (value == null) return null;
      return `${urlEncode(k)}=${encodeQualifierValue(StringCtor(value))}`;
    });
    // Filter out nulls
    const validPairs = ArrayPrototypeFilter(pairs, p => p !== null);
    if (validPairs.length > 0) {
      purl += `?${ArrayPrototypeJoin(validPairs, '&')}`;
    }
  }

  if (subpath) {
    // Use encodeSubpath to preserve slashes
    purl += `#${encodeSubpath(subpath)}`;
  }

  return purl;
}

// Check if a string is a valid PURL
function isValid(purl) {
  return tryParse(purl) !== null;
}

// Normalize a PURL (lowercase type, sort qualifiers)
function normalize(purl) {
  const parsed = parse(purl);
  return build(parsed);
}

// Compare two PURLs for equality
function equals(a, b) {
  return normalize(a) === normalize(b);
}

// Cache statistics
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

// Clear cache
function clearCache() {
  cache = { __proto__: null };
  cacheOrder = [];
  cacheHits = 0;
  cacheMisses = 0;
}

module.exports = {
  parse,
  tryParse,
  parseBatch,
  build,
  isValid,
  normalize,
  equals,
  cacheStats,
  clearCache,
  types,
  PurlError,
};

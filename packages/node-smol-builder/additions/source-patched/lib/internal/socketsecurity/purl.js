'use strict'

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
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeSet,
  ObjectEntries,
  ObjectFreeze,
  ObjectKeys,
  SafeMap,
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
  TypeError: TypeErrorCtor,
} = primordials

// Character codes for fast comparisons
const CHAR_HASH = 0x23 // #
const CHAR_QUESTION = 0x3f // ?
const CHAR_SLASH = 0x2f // /
const CHAR_AT = 0x40 // @
const CHAR_SPACE = 0x20 // ' '
const CHAR_TAB = 0x09 // \t
const CHAR_CR = 0x0d // \r
const CHAR_LF = 0x0a // \n

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
})

// Type string intern map - reuse common type strings instead of allocating fresh
const typeInternMap = new SafeMap()
{
  const keys = ObjectKeys(types)
  for (let i = 0, len = keys.length; i < len; i++) {
    const value = types[keys[i]]
    MapPrototypeSet(typeInternMap, value, value)
  }
}

// Intern a type string - returns cached instance for known types
function internType(type) {
  const interned = MapPrototypeGet(typeInternMap, type)
  return interned !== undefined ? interned : type
}

// Max PURL length to prevent DoS
const MAX_PURL_LENGTH = 4096

class PurlError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'PurlError'
    this.code = code
  }
}

// SafeMap-based LRU cache - O(1) eviction via insertion order
const CACHE_SIZE = 10000
let cache = new SafeMap()
let cacheHits = 0
let cacheMisses = 0

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
    // Evict oldest entry - SafeMap iterator gives insertion order, O(1)
    const oldest = cache.keys().next().value
    MapPrototypeDelete(cache, oldest)
  }
  MapPrototypeSet(cache, key, value)
}

// Reject control characters and null bytes from decoded strings.
// Prevents null byte injection (CRITICAL-2) and CRLF injection (HIGH-2).
function sanitizeDecoded(str) {
  for (let i = 0, len = str.length; i < len; i++) {
    const c = StringPrototypeCharCodeAt(str, i)
    if (c <= 0x1f || c === 0x7f) {
      throw new TypeErrorCtor(
        `Invalid control character in PURL component at position ${i}`,
      )
    }
  }
  return str
}

// URL decode - per PURL spec
// Fast path: skip decodeURIComponent when no % present
// Rejects null bytes and control characters after decoding.
function urlDecode(str) {
  if (StringPrototypeIndexOf(str, '%') === -1) return str
  let decoded
  try {
    decoded = decodeURIComponent(str)
  } catch {
    return str
  }
  return sanitizeDecoded(decoded)
}

// Decode qualifier value - per PURL spec, + is preserved as literal (NOT space)
// This differs from application/x-www-form-urlencoded
// Fast path: skip decodeURIComponent when no % present
function decodeQualifierValue(str) {
  if (StringPrototypeIndexOf(str, '%') === -1) return str
  try {
    // Per gold standard: just use decodeURIComponent, preserve + as literal
    return decodeURIComponent(str)
  } catch {
    return str
  }
}

// URL encode - per PURL spec
function urlEncode(str) {
  return encodeURIComponent(str)
}

// Encode name - allow colons unescaped
function encodeName(str) {
  return StringPrototypeReplaceAll(encodeURIComponent(str), '%3A', ':')
}

// Encode namespace - allow colons and slashes unescaped (for golang, etc.)
function encodeNamespace(str) {
  let encoded = encodeURIComponent(str)
  encoded = StringPrototypeReplaceAll(encoded, '%3A', ':')
  encoded = StringPrototypeReplaceAll(encoded, '%2F', '/')
  return encoded
}

// Encode version - allow colons unescaped
function encodeVersion(str) {
  return StringPrototypeReplaceAll(encodeURIComponent(str), '%3A', ':')
}

// Encode subpath - allow slashes unescaped
function encodeSubpath(str) {
  return StringPrototypeReplaceAll(encodeURIComponent(str), '%2F', '/')
}

// Encode qualifier value - per PURL spec (spaces -> %20, + -> %2B)
function encodeQualifierValue(str) {
  // Replace spaces with %20 so they don't become +
  const prepared = StringPrototypeReplaceAll(str, ' ', '%20')
  const encoded = encodeURIComponent(prepared)
  // URLSearchParams would encode %20 to %2520 and space to +, we want %20 for spaces
  // Also ensure + signs are encoded as %2B
  let result = StringPrototypeReplaceAll(encoded, '%2520', '%20')
  result = StringPrototypeReplaceAll(result, '+', '%2B')
  return result
}

// Trim leading slashes (pkg:// should be treated as pkg:)
function trimLeadingSlashes(str) {
  let i = 0
  while (i < str.length && str[i] === '/') i++
  return i > 0 ? StringPrototypeSlice(str, i) : str
}

// Collapse multiple consecutive slashes to single slash
// Per PURL spec and gold standard: foo//bar -> foo/bar
// Single-pass approach: build result character by character
function collapseSlashes(str) {
  // Fast path: no double slashes
  if (StringPrototypeIndexOf(str, '//') === -1) return str
  // Single-pass: scan and skip consecutive slashes
  let result = ''
  let prevSlash = false
  for (let i = 0, len = str.length; i < len; i++) {
    const ch = StringPrototypeCharCodeAt(str, i)
    if (ch === CHAR_SLASH) {
      if (!prevSlash) {
        result += '/'
        prevSlash = true
      }
    } else {
      result += str[i]
      prevSlash = false
    }
  }
  return result
}

// Fast check if string needs trimming
function needsTrim(str) {
  const len = str.length
  if (len === 0) return false
  const first = StringPrototypeCharCodeAt(str, 0)
  if (
    first === CHAR_SPACE ||
    first === CHAR_TAB ||
    first === CHAR_CR ||
    first === CHAR_LF
  )
    return true
  const last = StringPrototypeCharCodeAt(str, len - 1)
  if (
    last === CHAR_SPACE ||
    last === CHAR_TAB ||
    last === CHAR_CR ||
    last === CHAR_LF
  )
    return true
  return false
}

// Fast trim - skip call if unnecessary
function fastTrim(str) {
  return needsTrim(str) ? StringPrototypeTrim(str) : str
}

// Filter subpath segments - remove . and .. per PURL spec
function filterSubpathSegments(subpath) {
  if (!subpath) return undefined
  const segments = StringPrototypeSplit(subpath, '/')
  const filtered = ArrayPrototypeFilter(segments, seg => {
    // Remove empty segments, '.', and '..'
    return seg && seg !== '.' && seg !== '..'
  })
  if (filtered.length === 0) return undefined
  return ArrayPrototypeJoin(filtered, '/')
}

// Single-pass delimiter scanning
// Finds positions of #, ?, first /, and @ in one traversal
function scanDelimiters(str) {
  let hashIdx = -1
  let queryIdx = -1
  let firstSlashIdx = -1

  for (let i = 0, len = str.length; i < len; i++) {
    const ch = StringPrototypeCharCodeAt(str, i)
    if (ch === CHAR_HASH && hashIdx === -1) {
      hashIdx = i
      // Everything after # is subpath, stop scanning for ? and /
      break
    }
    if (ch === CHAR_QUESTION && queryIdx === -1) {
      queryIdx = i
      // After ?, only # matters
      continue
    }
    if (ch === CHAR_SLASH && firstSlashIdx === -1 && queryIdx === -1) {
      firstSlashIdx = i
    }
  }

  // If we found a hash, we still need to check for ? before it
  if (hashIdx !== -1 && queryIdx === -1) {
    for (let i = 0; i < hashIdx; i++) {
      const ch = StringPrototypeCharCodeAt(str, i)
      if (ch === CHAR_QUESTION) {
        queryIdx = i
        break
      }
    }
  }

  // Find first slash if we haven't yet (only in pre-query portion)
  if (firstSlashIdx === -1) {
    const end =
      queryIdx !== -1 ? queryIdx : hashIdx !== -1 ? hashIdx : str.length
    for (let i = 0; i < end; i++) {
      if (StringPrototypeCharCodeAt(str, i) === CHAR_SLASH) {
        firstSlashIdx = i
        break
      }
    }
  }

  return { __proto__: null, hashIdx, queryIdx, firstSlashIdx }
}

// Parse a PURL string
function parse(purl) {
  if (typeof purl !== 'string') {
    throw new PurlError('PURL must be a string', 'ERR_INVALID_TYPE')
  }

  // Length validation to prevent DoS
  if (purl.length > MAX_PURL_LENGTH) {
    throw new PurlError(
      `PURL exceeds maximum length of ${MAX_PURL_LENGTH}`,
      'ERR_TOO_LONG',
    )
  }

  // Check cache
  const cached = cacheGet(purl)
  if (cached !== undefined) return cached

  // Handle pkg:// (ignore double slashes per spec)
  // Case-insensitive scheme check per gold standard (PkG: is valid)
  let rest
  const scheme = StringPrototypeToLowerCase(StringPrototypeSlice(purl, 0, 4))
  if (scheme === 'pkg:') {
    rest = trimLeadingSlashes(StringPrototypeSlice(purl, 4))
  } else {
    throw new PurlError('PURL must start with "pkg:"', 'ERR_INVALID_PREFIX')
  }

  // Single-pass delimiter scan
  const delimiters = scanDelimiters(rest)

  // Extract subpath (#subpath)
  let subpath
  if (delimiters.hashIdx !== -1) {
    const rawSubpath = urlDecode(
      StringPrototypeSlice(rest, delimiters.hashIdx + 1),
    )
    // Filter subpath segments per PURL spec (remove . and ..)
    subpath = filterSubpathSegments(rawSubpath)
    rest = StringPrototypeSlice(rest, 0, delimiters.hashIdx)
  }

  // Extract qualifiers (?key=value&key2=value2)
  let qualifiers
  const queryIdx = delimiters.queryIdx
  if (queryIdx !== -1) {
    const queryStr = StringPrototypeSlice(rest, queryIdx + 1)
    rest = StringPrototypeSlice(rest, 0, queryIdx)
    qualifiers = { __proto__: null }
    const pairs = StringPrototypeSplit(queryStr, '&')
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i]
      if (!pair) continue // Skip empty pairs
      const eqIdx = StringPrototypeIndexOf(pair, '=')
      if (eqIdx !== -1) {
        // Decode and trim key, then lowercase per spec
        const rawKey = urlDecode(StringPrototypeSlice(pair, 0, eqIdx))
        const trimmedKey = fastTrim(rawKey)
        const key = StringPrototypeToLowerCase(trimmedKey)
        if (!key) {
          throw new PurlError(
            'qualifier key must not be empty',
            'ERR_INVALID_QUALIFIER',
          )
        }
        // Decode value, then trim (per gold standard order)
        const decodedValue = decodeQualifierValue(
          StringPrototypeSlice(pair, eqIdx + 1),
        )
        const value = fastTrim(decodedValue)
        // Skip empty values after trimming (per gold standard)
        if (value) {
          qualifiers[key] = value
        }
      }
    }
  }

  // Extract type (before first /)
  const slashIdx = StringPrototypeIndexOf(rest, '/')
  if (slashIdx === -1) {
    throw new PurlError('PURL must have a type and name', 'ERR_INVALID_FORMAT')
  }

  const type = internType(
    StringPrototypeToLowerCase(
      urlDecode(StringPrototypeSlice(rest, 0, slashIdx)),
    ),
  )
  rest = StringPrototypeSlice(rest, slashIdx + 1)

  // For npm type, handle special version parsing for pnpm peer dep syntax
  // e.g., pkg:npm/next@14.2.10(react-dom@18.3.1(react@18.3.1))
  let version
  let atIdx
  if (type === 'npm') {
    // For npm, find the first @ after any leading @scope/
    const startPos = rest[0] === '@' ? StringPrototypeIndexOf(rest, '/') + 1 : 0
    atIdx =
      startPos > 0
        ? StringPrototypeIndexOf(rest, '@', startPos)
        : StringPrototypeIndexOf(rest, '@')
  } else {
    // For other types, use lastIndexOf to handle @ in version strings
    atIdx = StringPrototypeLastIndexOf(rest, '@')
  }

  // When @ directly follows /, it's a scoped package marker not version separator
  if (atIdx > 0 && rest[atIdx - 1] === '/') {
    atIdx = -1
  }

  if (atIdx !== -1 && atIdx > 0) {
    // Trim version whitespace per gold standard
    version = fastTrim(urlDecode(StringPrototypeSlice(rest, atIdx + 1)))
    rest = StringPrototypeSlice(rest, 0, atIdx)
  }

  // Collapse multiple slashes before extracting namespace/name
  rest = collapseSlashes(rest)

  // Extract namespace and name
  let namespace
  let name
  const lastSlashIdx = StringPrototypeLastIndexOf(rest, '/')
  if (lastSlashIdx !== -1) {
    // Trim namespace and name whitespace per gold standard
    namespace = fastTrim(urlDecode(StringPrototypeSlice(rest, 0, lastSlashIdx)))
    name = fastTrim(urlDecode(StringPrototypeSlice(rest, lastSlashIdx + 1)))
    // Reject path traversal in namespace (HIGH-1: prevents ../../etc/passwd).
    if (StringPrototypeIndexOf(namespace, '..') !== -1) {
      throw new TypeErrorCtor('Invalid PURL: namespace contains path traversal')
    }
  } else {
    name = fastTrim(urlDecode(rest))
  }

  if (!name) {
    throw new PurlError('PURL must have a name', 'ERR_MISSING_NAME')
  }

  // Type-specific normalization
  let normalizedNamespace = namespace
  let normalizedName = name

  if (type === 'npm') {
    // npm: lowercase namespace and name (except legacy names)
    if (normalizedNamespace) {
      normalizedNamespace = StringPrototypeToLowerCase(normalizedNamespace)
    }
    normalizedName = StringPrototypeToLowerCase(normalizedName)
  } else if (type === 'pypi') {
    // pypi: lowercase and replace underscores/periods with hyphens
    normalizedName = StringPrototypeToLowerCase(normalizedName)
    // Replace underscores with dashes
    let result = ''
    let fromIndex = 0
    let index = 0
    while (
      (index = StringPrototypeIndexOf(normalizedName, '_', fromIndex)) !== -1
    ) {
      result = `${result + StringPrototypeSlice(normalizedName, fromIndex, index)}-`
      fromIndex = index + 1
    }
    normalizedName = fromIndex
      ? result + StringPrototypeSlice(normalizedName, fromIndex)
      : normalizedName
    // Replace periods with dashes (per gold standard)
    result = ''
    fromIndex = 0
    while (
      (index = StringPrototypeIndexOf(normalizedName, '.', fromIndex)) !== -1
    ) {
      result = `${result + StringPrototypeSlice(normalizedName, fromIndex, index)}-`
      fromIndex = index + 1
    }
    normalizedName = fromIndex
      ? result + StringPrototypeSlice(normalizedName, fromIndex)
      : normalizedName
  }

  const result = {
    __proto__: null,
    type,
    namespace: normalizedNamespace,
    name: normalizedName,
    version,
    qualifiers,
    subpath,
  }

  // Freeze result before caching to prevent cache poisoning (MEDIUM-3).
  ObjectFreeze(result)
  if (qualifiers) ObjectFreeze(qualifiers)
  cachePut(purl, result)
  return result
}

// Try to parse, returns undefined on failure
function tryParse(purl) {
  try {
    return parse(purl)
  } catch {
    return undefined
  }
}

// Parse multiple PURLs
function parseBatch(purls) {
  if (!Array.isArray(purls)) {
    throw new PurlError('parseBatch requires an array', 'ERR_INVALID_TYPE')
  }
  return ArrayPrototypeMap(purls, p => tryParse(p))
}

// Build a PURL string from components
function build(options) {
  if (!options || typeof options !== 'object') {
    throw new PurlError('build requires an options object', 'ERR_INVALID_TYPE')
  }

  const { type, namespace, name, version, qualifiers, subpath } = options

  if (!type) {
    throw new PurlError('type is required', 'ERR_MISSING_TYPE')
  }
  if (!name) {
    throw new PurlError('name is required', 'ERR_MISSING_NAME')
  }

  const normalizedType = StringPrototypeToLowerCase(type)
  let purl = `pkg:${normalizedType}/`

  if (namespace) {
    // Use encodeNamespace to preserve slashes for golang, etc.
    purl += `${encodeNamespace(namespace)}/`
  }

  // Use encodeName to allow colons
  purl += encodeName(name)

  if (version) {
    // Use encodeVersion to allow colons
    purl += `@${encodeVersion(version)}`
  }

  if (qualifiers && ObjectKeys(qualifiers).length > 0) {
    // Sort qualifier keys lexicographically per spec
    const sortedKeys = ArrayPrototypeSort(ArrayFrom(ObjectKeys(qualifiers)))
    const pairs = ArrayPrototypeMap(sortedKeys, k => {
      const value = qualifiers[k]
      // Skip undefined values
      if (value === undefined) return undefined
      return `${urlEncode(k)}=${encodeQualifierValue(StringCtor(value))}`
    })
    // Filter out undefined
    const validPairs = ArrayPrototypeFilter(pairs, p => p !== undefined)
    if (validPairs.length > 0) {
      purl += `?${ArrayPrototypeJoin(validPairs, '&')}`
    }
  }

  if (subpath) {
    // Use encodeSubpath to preserve slashes
    purl += `#${encodeSubpath(subpath)}`
  }

  return purl
}

// Check if a string is a valid PURL
function isValid(purl) {
  return tryParse(purl) !== undefined
}

// Normalize a PURL (lowercase type, sort qualifiers)
function normalize(purl) {
  const parsed = parse(purl)
  return build(parsed)
}

// Compare two PURLs for equality
function equals(a, b) {
  return normalize(a) === normalize(b)
}

// Cache statistics
function cacheStats() {
  const total = cacheHits + cacheMisses
  return {
    __proto__: null,
    size: cache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total > 0 ? cacheHits / total : 0,
  }
}

// Clear cache
function clearCache() {
  cache = new SafeMap()
  cacheHits = 0
  cacheMisses = 0
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
}

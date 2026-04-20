'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/manifest.js.md

const {
  ArrayPrototypeFilter,
  ArrayPrototypePush,
  JSONParse,
  ObjectFreeze,
  ObjectKeys,
  RegExp: RegExpCtor,
  RegExpPrototypeExec,
  RegExpPrototypeTest,
  SafeSet,
  SetPrototypeAdd,
  SetPrototypeDelete,
  SetPrototypeHas,
  String: StringCtor,
  StringPrototypeEndsWith,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeReplace,
  StringPrototypeReplaceAll,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeTrim,
  hardenRegExp,
} = primordials

// Interned common strings
const PROD = 'prod'
const DEV = 'dev'
const OPTIONAL = 'optional'
const PEER = 'peer'
const NPM = 'npm'

// Hoisted regex patterns
const RE_QUOTE_START = hardenRegExp(/^"/)
const RE_QUOTE_END = hardenRegExp(/"$/)
const RE_LOCKFILE_VERSION = hardenRegExp(
  /lockfileVersion:\s*['"]?([0-9.]+)['"]?/,
)
const RE_INTEGRITY = hardenRegExp(/integrity:\s*([a-zA-Z0-9+/=-]+)/)
const RE_TARBALL = hardenRegExp(/tarball:\s*['"]?([^'"}\s]+)['"]?/)

class ManifestError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ManifestError'
    this.code = code
  }
}

// Supported file patterns. Inner entries are frozen null-proto objects so
// detectFormat() can return them directly without per-call allocation.
const MANIFEST_PATTERNS = ObjectFreeze({
  __proto__: null,
  'package.json': ObjectFreeze({
    __proto__: null,
    ecosystem: 'npm',
    type: 'manifest',
  }),
  'composer.json': ObjectFreeze({
    __proto__: null,
    ecosystem: 'composer',
    type: 'manifest',
  }),
})

const LOCKFILE_PATTERNS = ObjectFreeze({
  __proto__: null,
  'package-lock.json': ObjectFreeze({
    __proto__: null,
    ecosystem: 'npm',
    format: 'npm',
    type: 'lockfile',
  }),
  'npm-shrinkwrap.json': ObjectFreeze({
    __proto__: null,
    ecosystem: 'npm',
    format: 'npm',
    type: 'lockfile',
  }),
  'yarn.lock': ObjectFreeze({
    __proto__: null,
    ecosystem: 'npm',
    format: 'yarn',
    type: 'lockfile',
  }),
  'pnpm-lock.yaml': ObjectFreeze({
    __proto__: null,
    ecosystem: 'npm',
    format: 'pnpm',
    type: 'lockfile',
  }),
  'composer.lock': ObjectFreeze({
    __proto__: null,
    ecosystem: 'composer',
    format: 'composer',
    type: 'lockfile',
  }),
})

const supportedFiles = ObjectFreeze({
  __proto__: null,
  manifests: ObjectFreeze(ObjectKeys(MANIFEST_PATTERNS)),
  lockfiles: ObjectFreeze(ObjectKeys(LOCKFILE_PATTERNS)),
})

// Detect format from filename. Returned objects are shared immutables — safe
// because callers only read properties (see parseManifest/parseLockfile).
function detectFormat(filename) {
  const lastSlash = StringPrototypeLastIndexOf(filename, '/')
  const basename =
    lastSlash === -1 ? filename : StringPrototypeSlice(filename, lastSlash + 1)
  return (
    MANIFEST_PATTERNS[basename] || LOCKFILE_PATTERNS[basename] || undefined
  )
}

// Parse package.json
function parsePackageJson(content) {
  let data
  try {
    data = JSONParse(content)
  } catch (e) {
    throw new ManifestError(`Invalid JSON: ${e.message}`, 'ERR_INVALID_JSON')
  }

  const dependencies = []

  // Helper to add deps
  const addDeps = (obj, type) => {
    if (!obj || typeof obj !== 'object') {
      return
    }
    const keys = ObjectKeys(obj)
    for (let i = 0, len = keys.length; i < len; i++) {
      const name = keys[i]
      ArrayPrototypePush(
        dependencies,
        ObjectFreeze({
          __proto__: null,
          name,
          versionRange: obj[name],
          type,
          optional: type === OPTIONAL,
        }),
      )
    }
  }

  addDeps(data.dependencies, PROD)
  addDeps(data.devDependencies, DEV)
  addDeps(data.peerDependencies, PEER)
  addDeps(data.optionalDependencies, OPTIONAL)

  return ObjectFreeze({
    __proto__: null,
    type: 'manifest',
    name: data.name || undefined,
    version: data.version || undefined,
    description: data.description || undefined,
    license: data.license || undefined,
    repository:
      typeof data.repository === 'string'
        ? data.repository
        : data.repository?.url || undefined,
    dependencies: ObjectFreeze(dependencies),
    ecosystem: NPM,
  })
}

// Parse git URL from resolved field (P0.3: Git dependency detection)
function parseGitUrl(resolved) {
  // Check if this is a git URL
  if (
    StringPrototypeIndexOf(resolved, 'git+') !== 0 &&
    StringPrototypeIndexOf(resolved, 'git://') !== 0
  ) {
    return undefined
  }

  // Extract URL and commit
  const hashIndex = StringPrototypeIndexOf(resolved, '#')
  if (hashIndex === -1) {
    // No commit hash
    return { __proto__: null, url: resolved, commit: undefined }
  }

  const url = StringPrototypeSlice(resolved, 0, hashIndex)
  const commit = StringPrototypeSlice(resolved, hashIndex + 1)

  return { __proto__: null, url, commit }
}

// Extract package name from node_modules path
function extractPackageNameFromPath(pkgPath) {
  // Find the last occurrence of node_modules to handle nested paths
  // e.g., "node_modules/a/node_modules/b/node_modules/c" -> "c".
  // npm lockfiles generated on Windows may use `\\` separators; normalize
  // first so both forms are handled.
  const normalized = StringPrototypeReplaceAll(pkgPath, '\\', '/')
  const lastNmIdx = StringPrototypeLastIndexOf(normalized, 'node_modules/')
  if (lastNmIdx === -1) {
    return normalized
  }

  const withoutPrefix = StringPrototypeSlice(normalized, lastNmIdx + 13) // 'node_modules/'.length

  // Handle scoped packages (@scope/name)
  if (withoutPrefix[0] === '@') {
    const parts = StringPrototypeSplit(withoutPrefix, '/')
    // Validate scoped package format has both scope and name
    if (parts.length < 2) {
      return withoutPrefix
    }
    return `${parts[0]}/${parts[1]}`
  }

  // Regular packages - take first part before any /
  const firstSlash = StringPrototypeIndexOf(withoutPrefix, '/')
  if (firstSlash === -1) {
    return withoutPrefix
  }
  return StringPrototypeSlice(withoutPrefix, 0, firstSlash)
}

// Parse package-lock.json
function parsePackageLock(content) {
  let data
  try {
    data = JSONParse(content)
  } catch (e) {
    throw new ManifestError(`Invalid JSON: ${e.message}`, 'ERR_INVALID_JSON')
  }

  const packageIndex = { __proto__: null }

  // Helper to add index entry supporting multiple versions
  const addToIndex = (name, idx) => {
    if (packageIndex[name] === undefined) {
      packageIndex[name] = idx
    } else if (typeof packageIndex[name] === 'number') {
      packageIndex[name] = [packageIndex[name], idx]
    } else {
      ArrayPrototypePush(packageIndex[name], idx)
    }
  }

  // v2/v3 format uses "packages"
  if (data.packages) {
    const pkgKeys = ObjectKeys(data.packages)
    // Pre-size: subtract 1 for the root '' entry if present
    const packages = new Array(
      data.packages[''] !== undefined ? pkgKeys.length - 1 : pkgKeys.length,
    )
    let pkgCount = 0

    for (let ki = 0, klen = pkgKeys.length; ki < klen; ki++) {
      const pkgPath = pkgKeys[ki]
      // Skip root package
      if (pkgPath === '') {
        continue
      }

      const pkg = data.packages[pkgPath]
      // Extract name from path using proper scoped package handling
      const name = extractPackageNameFromPath(pkgPath)
      const version = pkg.version || '0.0.0'

      // P0.3: Git dependency detection
      let vcsUrl
      let vcsCommit
      if (pkg.resolved) {
        const gitMatch = parseGitUrl(pkg.resolved)
        if (gitMatch) {
          vcsUrl = gitMatch.url
          vcsCommit = gitMatch.commit
        }
      }

      const ref = ObjectFreeze({
        __proto__: null,
        name,
        version,
        resolved: pkg.resolved || undefined,
        integrity: pkg.integrity || undefined,
        ecosystem: NPM,
        depType: pkg.dev
          ? DEV
          : pkg.optional
            ? OPTIONAL
            : pkg.peer
              ? PEER
              : PROD,
        isDev: !!pkg.dev,
        isOptional: !!pkg.optional,
        isPeer: !!pkg.peer,
        isBundled: !!pkg.inBundle,
        license: pkg.license || undefined,
        vcsUrl,
        vcsCommit,
        dependencies: pkg.dependencies ? ObjectKeys(pkg.dependencies) : [],
      })

      packages[pkgCount] = ref
      addToIndex(name, pkgCount)
      pkgCount++
    }
    // Trim if needed
    packages.length = pkgCount

    return ObjectFreeze({
      __proto__: null,
      type: 'lockfile',
      lockVersion: StringCtor(data.lockfileVersion || 1),
      ecosystem: NPM,
      packages: ObjectFreeze(packages),
      _index: packageIndex,
    })
  }

  const packages = []

  // v1 format uses "dependencies"
  if (data.dependencies) {
    const visited = new SafeSet()
    const flatten = (deps, parentPath = '') => {
      const depKeys = ObjectKeys(deps)
      for (let di = 0, dlen = depKeys.length; di < dlen; di++) {
        const name = depKeys[di]
        const pkg = deps[name]
        const version = pkg.version || '0.0.0'
        const key = `${name}@${version}`

        // Skip if already visited (prevents infinite recursion on circular deps)
        if (SetPrototypeHas(visited, key)) {
          continue
        }

        // Only add if not already present (first occurrence wins)
        if (packageIndex[name] === undefined) {
          // P0.3: Git dependency detection
          let vcsUrl
          let vcsCommit
          if (pkg.resolved) {
            const gitMatch = parseGitUrl(pkg.resolved)
            if (gitMatch) {
              vcsUrl = gitMatch.url
              vcsCommit = gitMatch.commit
            }
          }

          const ref = ObjectFreeze({
            __proto__: null,
            name,
            version,
            resolved: pkg.resolved || undefined,
            integrity: pkg.integrity || undefined,
            ecosystem: NPM,
            depType: pkg.dev
              ? DEV
              : pkg.optional
                ? OPTIONAL
                : pkg.peer
                  ? PEER
                  : PROD,
            isDev: !!pkg.dev,
            isOptional: !!pkg.optional,
            isPeer: !!pkg.peer,
            isBundled: !!pkg.inBundle,
            vcsUrl,
            vcsCommit,
            dependencies: pkg.requires ? ObjectKeys(pkg.requires) : [],
          })

          ArrayPrototypePush(packages, ref)
          packageIndex[name] = packages.length - 1
        }

        // Recursively flatten nested dependencies
        if (pkg.dependencies) {
          SetPrototypeAdd(visited, key)
          flatten(pkg.dependencies, `${parentPath}/${name}`)
          SetPrototypeDelete(visited, key)
        }
      }
    }
    flatten(data.dependencies)
  }

  return ObjectFreeze({
    __proto__: null,
    type: 'lockfile',
    lockVersion: StringCtor(data.lockfileVersion || 1),
    ecosystem: NPM,
    packages: ObjectFreeze(packages),
    _index: packageIndex,
  })
}

// Parse yarn.lock descriptor (Classic and Berry)
function parseYarnDescriptor(descriptor) {
  // Handle Yarn Berry protocols (patch:, portal:, workspace:)
  if (StringPrototypeIndexOf(descriptor, 'patch:') === 0) {
    // Extract the package name after 'patch:' and before '@npm:' or '@workspace:'
    const afterPatch = StringPrototypeSlice(descriptor, 6) // 'patch:'.length
    let npmIndex = StringPrototypeIndexOf(afterPatch, '@npm:')
    const npmEncodedIndex = StringPrototypeIndexOf(afterPatch, '@npm%3A')
    const workspaceIndex = StringPrototypeIndexOf(afterPatch, '@workspace:')

    // Use the first valid occurrence
    if (
      npmEncodedIndex > 0 &&
      (npmIndex === -1 || npmEncodedIndex < npmIndex)
    ) {
      npmIndex = npmEncodedIndex
    }

    if (npmIndex > 0) {
      return { name: StringPrototypeSlice(afterPatch, 0, npmIndex) }
    }
    if (workspaceIndex > 0) {
      return { name: StringPrototypeSlice(afterPatch, 0, workspaceIndex) }
    }
  }

  // Handle standard Berry descriptors with @npm: or @workspace:
  let protocolIndex = StringPrototypeIndexOf(descriptor, '@npm:')
  if (protocolIndex > 0) {
    return { name: StringPrototypeSlice(descriptor, 0, protocolIndex) }
  }

  protocolIndex = StringPrototypeIndexOf(descriptor, '@workspace:')
  if (protocolIndex > 0) {
    return { name: StringPrototypeSlice(descriptor, 0, protocolIndex) }
  }

  // Fallback: use last @ as separator (Classic Yarn)
  const atIdx = StringPrototypeLastIndexOf(descriptor, '@')
  if (atIdx > 0) {
    return { name: StringPrototypeSlice(descriptor, 0, atIdx) }
  }

  // If no @ found, return the whole descriptor as name
  return { name: descriptor }
}

// Parse yarn.lock (supports v1 Classic and v2+ Berry formats)
// Aligned with socket-sbom-generator gold standard
function parseYarnLock(content) {
  const packages = []
  const packageIndex = { __proto__: null }

  // Helper to add index entry supporting multiple versions
  const addToYarnIndex = (name, idx) => {
    if (packageIndex[name] === undefined) {
      packageIndex[name] = idx
    } else if (typeof packageIndex[name] === 'number') {
      packageIndex[name] = [packageIndex[name], idx]
    } else {
      ArrayPrototypePush(packageIndex[name], idx)
    }
  }

  // Detect Berry format by __metadata field
  const isBerry = StringPrototypeIndexOf(content, '__metadata:') !== -1

  // Helper to strip surrounding quotes from a value
  const stripQuotes = s =>
    StringPrototypeReplace(
      StringPrototypeReplace(s, RE_QUOTE_START, ''),
      RE_QUOTE_END,
      '',
    )

  // indexOf-based line scanning (no split)
  let pos = 0
  // We need a lines-like interface but scanning by position.
  // We'll use a helper to peek at indented sub-lines.
  // Since the original code indexes lines[i] extensively, we collect lines on the fly
  // into a local buffer only for the current block.

  while (pos < content.length) {
    const eol = StringPrototypeIndexOf(content, '\n', pos)
    const end = eol === -1 ? content.length : eol
    const line = StringPrototypeSlice(content, pos, end)
    pos = end + 1

    // Skip empty lines and comments
    if (!line || StringPrototypeTrim(line) === '' || line[0] === '#') {
      continue
    }

    // Skip __metadata in Berry
    if (StringPrototypeTrim(line) === '__metadata:') {
      // Skip until next top-level entry
      while (pos < content.length) {
        const neol = StringPrototypeIndexOf(content, '\n', pos)
        const nend = neol === -1 ? content.length : neol
        const nline = StringPrototypeSlice(content, pos, nend)
        if (nline.length === 0 || (nline[0] !== ' ' && nline[0] !== '\t')) {
          break
        }
        pos = nend + 1
      }
      continue
    }

    // Package declaration (starts at column 0, optionally quoted, ends with :)
    if (
      line[0] !== ' ' &&
      line[0] !== '\t' &&
      StringPrototypeEndsWith(StringPrototypeTrim(line), ':')
    ) {
      const spec = StringPrototypeTrim(StringPrototypeSlice(line, 0, -1))

      // Skip workspace entries in Berry (linkType: soft)
      let linkType

      // Extract package name
      let name = spec
      // Remove quotes
      name = stripQuotes(name)

      // Handle multiple specs: "name@^1.0.0, name@^1.1.0"
      const commaIdx = StringPrototypeIndexOf(name, ',')
      if (commaIdx !== -1) {
        name = StringPrototypeTrim(StringPrototypeSlice(name, 0, commaIdx))
      }

      // Skip workspace: protocol entries
      if (StringPrototypeIndexOf(name, '@workspace:') !== -1) {
        while (pos < content.length) {
          const neol = StringPrototypeIndexOf(content, '\n', pos)
          const nend = neol === -1 ? content.length : neol
          const nline = StringPrototypeSlice(content, pos, nend)
          if (nline.length === 0 || (nline[0] !== ' ' && nline[0] !== '\t'))
            break
          pos = nend + 1
        }
        continue
      }

      // Parse descriptor
      const parsed = parseYarnDescriptor(name)
      name = parsed.name

      let version
      let resolved
      let integrity
      let checksum
      let dependencies = []
      let isOptional = false

      // Parse indented properties
      while (pos < content.length) {
        const peol = StringPrototypeIndexOf(content, '\n', pos)
        const pend = peol === -1 ? content.length : peol
        const pline = StringPrototypeSlice(content, pos, pend)

        if (pline.length === 0 || (pline[0] !== ' ' && pline[0] !== '\t')) {

          break

        }

        const propLine = StringPrototypeTrim(pline)
        pos = pend + 1

        // Check for "version" with space or colon after
        if (
          StringPrototypeIndexOf(propLine, 'version ') === 0 ||
          StringPrototypeIndexOf(propLine, 'version:') === 0
        ) {
          const colonIdx = StringPrototypeIndexOf(propLine, ':')
          if (colonIdx === -1) {
            version = stripQuotes(
              StringPrototypeTrim(StringPrototypeSlice(propLine, 8)),
            )
          } else {
            version = stripQuotes(
              StringPrototypeTrim(StringPrototypeSlice(propLine, colonIdx + 1)),
            )
          }
        } else if (
          StringPrototypeIndexOf(propLine, 'resolved ') === 0 ||
          StringPrototypeIndexOf(propLine, 'resolved:') === 0
        ) {
          const colonIdx = StringPrototypeIndexOf(propLine, ':')
          if (colonIdx === -1) {
            resolved = stripQuotes(
              StringPrototypeTrim(StringPrototypeSlice(propLine, 9)),
            )
          } else {
            resolved = stripQuotes(
              StringPrototypeTrim(StringPrototypeSlice(propLine, colonIdx + 1)),
            )
          }
        } else if (
          StringPrototypeIndexOf(propLine, 'integrity ') === 0 ||
          StringPrototypeIndexOf(propLine, 'integrity:') === 0
        ) {
          const colonIdx = StringPrototypeIndexOf(propLine, ':')
          if (colonIdx === -1) {
            integrity = StringPrototypeTrim(StringPrototypeSlice(propLine, 10))
          } else {
            integrity = StringPrototypeTrim(
              StringPrototypeSlice(propLine, colonIdx + 1),
            )
          }
        } else if (
          StringPrototypeIndexOf(propLine, 'checksum ') === 0 ||
          StringPrototypeIndexOf(propLine, 'checksum:') === 0
        ) {
          const colonIdx = StringPrototypeIndexOf(propLine, ':')
          if (colonIdx === -1) {
            checksum = StringPrototypeTrim(StringPrototypeSlice(propLine, 9))
          } else {
            checksum = StringPrototypeTrim(
              StringPrototypeSlice(propLine, colonIdx + 1),
            )
          }
        } else if (StringPrototypeIndexOf(propLine, 'linkType') === 0) {
          const colonIdx = StringPrototypeIndexOf(propLine, ':')
          if (colonIdx > 0) {
            linkType = StringPrototypeTrim(
              StringPrototypeSlice(propLine, colonIdx + 1),
            )
          }
        } else if (StringPrototypeIndexOf(propLine, 'resolution') === 0) {
          // Berry resolution field
          const colonIdx = StringPrototypeIndexOf(propLine, ':')
          if (colonIdx > 0) {
            const resValue = stripQuotes(
              StringPrototypeTrim(StringPrototypeSlice(propLine, colonIdx + 1)),
            )
            if (
              StringPrototypeIndexOf(resValue, 'http://') === 0 ||
              StringPrototypeIndexOf(resValue, 'https://') === 0
            ) {
              resolved = resValue
            }
          }
        } else if (StringPrototypeIndexOf(propLine, 'dependencies:') === 0) {
          // Parse dependencies section
          while (pos < content.length) {
            const deol = StringPrototypeIndexOf(content, '\n', pos)
            const dend = deol === -1 ? content.length : deol
            const dline = StringPrototypeSlice(content, pos, dend)
            if (
              dline.length < 4 ||
              dline[0] !== ' ' ||
              dline[1] !== ' ' ||
              dline[2] !== ' ' ||
              dline[3] !== ' '
            )
              break
            const depLine = StringPrototypeTrim(dline)
            const dcolonIdx = StringPrototypeIndexOf(depLine, ':')
            if (dcolonIdx > 0) {
              ArrayPrototypePush(
                dependencies,
                StringPrototypeSlice(depLine, 0, dcolonIdx),
              )
            }
            pos = dend + 1
          }
          continue
        } else if (
          StringPrototypeIndexOf(propLine, 'dependenciesMeta:') === 0
        ) {
          // Check for optional dependencies in Berry
          while (pos < content.length) {
            const meol = StringPrototypeIndexOf(content, '\n', pos)
            const mend = meol === -1 ? content.length : meol
            const mline = StringPrototypeSlice(content, pos, mend)
            if (
              mline.length < 4 ||
              mline[0] !== ' ' ||
              mline[1] !== ' ' ||
              mline[2] !== ' ' ||
              mline[3] !== ' '
            )
              break
            const metaLine = StringPrototypeTrim(mline)
            if (
              StringPrototypeIndexOf(metaLine, 'optional:') !== -1 &&
              StringPrototypeIndexOf(metaLine, 'true') !== -1
            ) {
              isOptional = true
            }
            pos = mend + 1
          }
          continue
        }
      }

      // Skip workspace soft links in Berry
      if (isBerry && linkType === 'soft') {
        continue
      }

      if (name && version) {
        const ref = ObjectFreeze({
          __proto__: null,
          name,
          version,
          resolved,
          integrity: integrity || checksum || undefined,
          ecosystem: NPM,
          depType: PROD,
          isDev: false,
          isOptional,
          dependencies,
        })

        ArrayPrototypePush(packages, ref)
        addToYarnIndex(name, packages.length - 1)
      }

      continue
    }
  }

  return ObjectFreeze({
    __proto__: null,
    type: 'lockfile',
    lockVersion: isBerry ? 'berry' : '1',
    ecosystem: NPM,
    packages: ObjectFreeze(packages),
    _index: packageIndex,
  })
}

// Detect pnpm lockfile version from content
function detectPnpmVersion(content) {
  const match = RegExpPrototypeExec(RE_LOCKFILE_VERSION, content)
  if (match) {
    const version = match[1]
    if (version[0] === '5') {
      return 5
    }
    if (version[0] === '6') {
      return 6
    }
    if (version[0] === '9') {
      return 9
    }
  }
  // Default to v9 (latest)
  return 9
}

// Parse pnpm v5 package ID: /name/version or /@scope/name/version
function parsePnpmPackageIdV5(pkgId) {
  // Remove leading slash
  const withoutSlash = pkgId[0] === '/' ? StringPrototypeSlice(pkgId, 1) : pkgId

  // Handle peer dependency suffix (strip everything after "_")
  const underscoreIdx = StringPrototypeIndexOf(withoutSlash, '_')
  const withoutPeerSuffix =
    underscoreIdx !== -1
      ? StringPrototypeSlice(withoutSlash, 0, underscoreIdx)
      : withoutSlash

  // Handle scoped packages: @scope/name/version
  if (withoutPeerSuffix[0] === '@') {
    const parts = StringPrototypeSplit(withoutPeerSuffix, '/')
    if (parts.length < 2) {
      return { name: withoutPeerSuffix, version: '0.0.0' }
    }
    const name = `${parts[0]}/${parts[1]}`
    const version = parts[2] || '0.0.0'
    return { name, version }
  }

  // Regular packages: name/version
  const parts = StringPrototypeSplit(withoutPeerSuffix, '/')
  const name = parts[0] || withoutPeerSuffix
  const version = parts[1] || '0.0.0'
  return { name, version }
}

// Parse pnpm v6/v9 package ID: name@version or @scope/name@version
function parsePnpmPackageIdV6V9(pkgId) {
  // Handle peer dependency suffix (strip everything after "(")
  const parenIdx = StringPrototypeIndexOf(pkgId, '(')
  const withoutPeerSuffix =
    parenIdx !== -1 ? StringPrototypeSlice(pkgId, 0, parenIdx) : pkgId

  // Handle scoped packages: @scope/name@version
  if (withoutPeerSuffix[0] === '@') {
    // Find the last @ which separates version
    const lastAtIdx = StringPrototypeLastIndexOf(withoutPeerSuffix, '@')
    if (lastAtIdx > 0) {
      const name = StringPrototypeSlice(withoutPeerSuffix, 0, lastAtIdx)
      const version = StringPrototypeSlice(withoutPeerSuffix, lastAtIdx + 1)
      return { name, version }
    }
  } else {
    // Regular package: name@version
    const atIdx = StringPrototypeIndexOf(withoutPeerSuffix, '@')
    if (atIdx > 0) {
      const name = StringPrototypeSlice(withoutPeerSuffix, 0, atIdx)
      const version = StringPrototypeSlice(withoutPeerSuffix, atIdx + 1)
      return { name, version }
    }
  }

  // Fallback
  return { name: pkgId, version: '0.0.0' }
}

// Parse pnpm-lock.yaml (supports v5, v6, and v9 formats)
// Aligned with socket-sbom-generator gold standard
// P1.7: Includes workspace/monorepo support via importers
function parsePnpmLock(content) {
  const packages = []
  const packageIndex = { __proto__: null }

  const lockVersion = detectPnpmVersion(content)
  const isV5 = lockVersion === 5

  // Helper to add index entry supporting multiple versions
  const addToPnpmIndex = (name, idx) => {
    if (packageIndex[name] === undefined) {
      packageIndex[name] = idx
    } else if (typeof packageIndex[name] === 'number') {
      packageIndex[name] = [packageIndex[name], idx]
    } else {
      ArrayPrototypePush(packageIndex[name], idx)
    }
  }

  let inPackages = false
  let inSnapshots = false
  let inImporters = false
  let currentPkg
  let currentIndent = 0
  let currentImporter
  let importerIndent = 0

  // indexOf-based line scanning (no split)
  let pos = 0
  while (pos < content.length) {
    const eol = StringPrototypeIndexOf(content, '\n', pos)
    const end = eol === -1 ? content.length : eol
    const line = StringPrototypeSlice(content, pos, end)
    pos = end + 1

    const trimmed = StringPrototypeTrim(line)

    // Detect packages section (v5, v6)
    if (trimmed === 'packages:') {
      inPackages = true
      inSnapshots = false
      inImporters = false
      continue
    }

    // Detect snapshots section (v9)
    if (trimmed === 'snapshots:') {
      inSnapshots = true
      inPackages = false
      inImporters = false
      continue
    }

    // Detect importers section (workspace/monorepo support)
    if (trimmed === 'importers:') {
      inImporters = true
      inPackages = false
      inSnapshots = false
      continue
    }

    // New top-level section ends current section
    if (
      line[0] !== ' ' &&
      line[0] !== '\t' &&
      trimmed.length > 0 &&
      trimmed !== 'packages:' &&
      trimmed !== 'snapshots:' &&
      trimmed !== 'importers:'
    ) {
      inPackages = false
      inSnapshots = false
      inImporters = false
      continue
    }

    // P1.7: Parse importers section for workspace dependencies
    if (inImporters) {
      // Calculate indent level
      let indent = 0
      while (
        indent < line.length &&
        (line[indent] === ' ' || line[indent] === '\t')
      ) {
        indent++
      }

      // Importer entry (workspace path)
      if (indent === 2 && StringPrototypeEndsWith(trimmed, ':')) {
        currentImporter = {
          __proto__: null,
          // Single cursor for the active section. Using separate booleans
          // that were never cleared caused later `dependencies:` blocks to
          // inherit a prior `devDependencies:` flag and mis-tag prod deps
          // as dev in the SBOM output.
          section: undefined,
        }
        importerIndent = indent
        continue
      }

      // Importer properties
      if (currentImporter && indent > importerIndent) {
        if (StringPrototypeIndexOf(trimmed, 'devDependencies:') === 0) {
          currentImporter.section = 'dev'
        } else if (
          StringPrototypeIndexOf(trimmed, 'optionalDependencies:') === 0
        ) {
          currentImporter.section = 'optional'
        } else if (StringPrototypeIndexOf(trimmed, 'dependencies:') === 0) {
          currentImporter.section = 'prod'
        } else if (indent > importerIndent + 2) {
          // Dependency entry: "    name: version"
          const colonIdx = StringPrototypeIndexOf(trimmed, ':')
          if (colonIdx > 0) {
            const depName = StringPrototypeSlice(trimmed, 0, colonIdx)
            const depVersion = StringPrototypeTrim(
              StringPrototypeSlice(trimmed, colonIdx + 1),
            )

            // Skip workspace links
            if (StringPrototypeIndexOf(depVersion, 'link:') === 0) {
              continue
            }

            // Parse version (handle peer dep suffix)
            const underIdx = StringPrototypeIndexOf(depVersion, '_')
            const versionNoPeer =
              underIdx !== -1
                ? StringPrototypeSlice(depVersion, 0, underIdx)
                : depVersion
            const parenIdx = StringPrototypeIndexOf(versionNoPeer, '(')
            const versionWithoutPeer =
              parenIdx !== -1
                ? StringPrototypeSlice(versionNoPeer, 0, parenIdx)
                : versionNoPeer

            // Add to packages if not already present
            if (packageIndex[depName] === undefined) {
              const ref = ObjectFreeze({
                __proto__: null,
                name: depName,
                version: versionWithoutPeer,
                resolved: undefined,
                integrity: undefined,
                ecosystem: NPM,
                depType:
                  currentImporter.section === 'dev'
                    ? DEV
                    : currentImporter.section === 'optional'
                      ? OPTIONAL
                      : PROD,
                isDev: currentImporter.section === 'dev',
                isOptional: currentImporter.section === 'optional',
                dependencies: [],
              })

              ArrayPrototypePush(packages, ref)
              packageIndex[depName] = packages.length - 1
            }
          }
        }
      }
      continue
    }

    if (!inPackages && !inSnapshots) {

      continue

    }

    // Calculate indent level
    let indent = 0
    while (
      indent < line.length &&
      (line[indent] === ' ' || line[indent] === '\t')
    ) {
      indent++
    }

    // Package entry detection
    // v5: starts with / (e.g., "  /lodash/4.17.21:")
    // v6/v9: package@version (e.g., "  lodash@4.17.21:")
    const isPackageEntry =
      indent >= 2 &&
      indent <= 4 &&
      StringPrototypeEndsWith(trimmed, ':') &&
      trimmed.length > 1

    if (isPackageEntry) {
      // Save previous package
      if (currentPkg && currentPkg.name) {
        // currentPkg already has a stable shape + null proto; freeze in place.
        ArrayPrototypePush(packages, ObjectFreeze(currentPkg))
        addToPnpmIndex(currentPkg.name, packages.length - 1)
      }

      // Parse package key
      const key = StringPrototypeSlice(trimmed, 0, trimmed.length - 1) // Remove trailing :

      let parsed
      if (key[0] === '/') {
        parsed = parsePnpmPackageIdV5(key)
      } else {
        parsed = parsePnpmPackageIdV6V9(key)
      }

      currentPkg = {
        __proto__: null,
        name: parsed.name,
        version: parsed.version,
        resolved: undefined,
        integrity: undefined,
        ecosystem: NPM,
        depType: PROD,
        isDev: false,
        isOptional: false,
        dependencies: [],
      }
      currentIndent = indent
      continue
    }

    // Properties (more indented than package entry)
    if (currentPkg && indent > currentIndent) {
      if (StringPrototypeIndexOf(trimmed, 'dev:') === 0) {
        if (StringPrototypeIndexOf(trimmed, 'true') !== -1) {
          currentPkg.depType = DEV
          currentPkg.isDev = true
        }
      } else if (StringPrototypeIndexOf(trimmed, 'optional:') === 0) {
        if (StringPrototypeIndexOf(trimmed, 'true') !== -1) {
          currentPkg.depType = OPTIONAL
          currentPkg.isOptional = true
        }
      } else if (StringPrototypeIndexOf(trimmed, 'integrity:') === 0) {
        currentPkg.integrity = StringPrototypeTrim(
          StringPrototypeSlice(trimmed, 10),
        )
      } else if (StringPrototypeIndexOf(trimmed, 'resolution:') === 0) {
        // resolution: {integrity: sha512-...}
        const intMatch = RegExpPrototypeExec(RE_INTEGRITY, trimmed)
        if (intMatch) {
          currentPkg.integrity = intMatch[1]
        }
        // Also check for tarball URL
        const tarballMatch = RegExpPrototypeExec(RE_TARBALL, trimmed)
        if (tarballMatch) {
          currentPkg.resolved = tarballMatch[1]
        }
      } else if (StringPrototypeIndexOf(trimmed, 'dependencies:') === 0) {
        currentPkg.dependencies = []
      } else if (currentPkg.dependencies && indent > currentIndent + 2) {
        // Dependency entry
        const colonIdx = StringPrototypeIndexOf(trimmed, ':')
        if (colonIdx > 0) {
          const depName = StringPrototypeSlice(trimmed, 0, colonIdx)
          ArrayPrototypePush(currentPkg.dependencies, depName)
        }
      }
    }
  }

  // Save last package.
  if (currentPkg && currentPkg.name) {
    ArrayPrototypePush(packages, ObjectFreeze(currentPkg))
    addToPnpmIndex(currentPkg.name, packages.length - 1)
  }

  return ObjectFreeze({
    __proto__: null,
    type: 'lockfile',
    lockVersion: StringCtor(lockVersion),
    ecosystem: NPM,
    packages: ObjectFreeze(packages),
    _index: packageIndex,
  })
}

// Parse manifest based on ecosystem
function parseManifest(content, ecosystem) {
  switch (ecosystem) {
    case 'npm':
      return parsePackageJson(content)
    default:
      throw new ManifestError(
        `Unsupported ecosystem: ${ecosystem}`,
        'ERR_UNSUPPORTED',
      )
  }
}

// Parse lockfile based on ecosystem and format
function parseLockfile(content, ecosystem, format) {
  switch (ecosystem) {
    case 'npm':
      switch (format) {
        case 'npm':
          return parsePackageLock(content)
        case 'yarn':
          return parseYarnLock(content)
        case 'pnpm':
          return parsePnpmLock(content)
        default:
          // Auto-detect
          if (StringPrototypeIndexOf(content, '"lockfileVersion"') !== -1) {
            return parsePackageLock(content)
          }
          if (
            StringPrototypeIndexOf(content, 'yarn lockfile') !== -1 ||
            StringPrototypeIndexOf(content, '__metadata:') !== -1
          ) {
            return parseYarnLock(content)
          }
          if (StringPrototypeIndexOf(content, 'lockfileVersion:') !== -1) {
            return parsePnpmLock(content)
          }
          throw new ManifestError(
            'Unable to detect lockfile format',
            'ERR_UNKNOWN_FORMAT',
          )
      }
    default:
      throw new ManifestError(
        `Unsupported ecosystem: ${ecosystem}`,
        'ERR_UNSUPPORTED',
      )
  }
}

// Auto-detect and parse
function parse(filename, content) {
  const format = detectFormat(filename)
  if (!format) {
    throw new ManifestError(
      `Unknown file format: ${filename}`,
      'ERR_UNKNOWN_FORMAT',
    )
  }

  if (format.type === 'manifest') {
    return parseManifest(content, format.ecosystem)
  } else {
    return parseLockfile(content, format.ecosystem, format.format)
  }
}

// Streaming parser (simplified - yields packages one by one)
async function* createStreamingParser(content, ecosystem) {
  // For now, just parse and yield - true streaming would require incremental parsing
  const result = parseLockfile(content, ecosystem)
  const pkgs = result.packages
  for (let i = 0, len = pkgs.length; i < len; i++) {
    yield pkgs[i]
  }
}

// Analyze lockfile statistics
function analyzeLockfile(lockfile) {
  let prodDeps = 0
  let devDeps = 0
  let optionalDeps = 0

  const pkgs = lockfile.packages
  for (let i = 0, len = pkgs.length; i < len; i++) {
    switch (pkgs[i].depType) {
      case PROD:
        prodDeps++
        break
      case DEV:
        devDeps++
        break
      case OPTIONAL:
        optionalDeps++
        break
    }
  }

  return ObjectFreeze({
    __proto__: null,
    totalPackages: lockfile.packages.length,
    prodDeps,
    devDeps,
    optionalDeps,
    byEcosystem: ObjectFreeze({
      __proto__: null,
      [lockfile.ecosystem]: lockfile.packages.length,
    }),
    maxDepth: 0, // Would require dependency tree analysis
    avgDepth: 0,
  })
}

// O(1) package lookup (returns first match, or undefined)
function getPackage(lockfile, name) {
  const idx = lockfile._index?.[name]
  if (idx === undefined) {
    return undefined
  }
  if (typeof idx === 'number') {
    return lockfile.packages[idx]
  }
  // Array of indices - return first
  return lockfile.packages[idx[0]]
}

// Get all versions of a package by name
function getPackageVersions(lockfile, name) {
  const idx = lockfile._index?.[name]
  if (idx === undefined) {
    return []
  }
  if (typeof idx === 'number') {
    return [lockfile.packages[idx]]
  }
  // Array of indices
  const result = new Array(idx.length)
  for (let i = 0, len = idx.length; i < len; i++) {
    result[i] = lockfile.packages[idx[i]]
  }
  return result
}

// Find packages matching pattern
function findPackages(lockfile, pattern) {
  const regex = pattern instanceof RegExpCtor ? pattern : RegExpCtor(pattern)
  return ArrayPrototypeFilter(lockfile.packages, pkg =>
    RegExpPrototypeTest(regex, pkg.name),
  )
}

module.exports = {
  __proto__: null,
  parse,
  parseManifest,
  parseLockfile,
  createStreamingParser,
  analyzeLockfile,
  getPackage,
  getPackageVersions,
  findPackages,
  detectFormat,
  supportedFiles,
  ManifestError,
}

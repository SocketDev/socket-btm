'use strict';

// Internal manifest and lockfile parser
// Supports: package.json, package-lock.json, yarn.lock, pnpm-lock.yaml, etc.

const {
  ArrayPrototypeFilter,
  ArrayPrototypeFind,
  ArrayPrototypeForEach,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  JSONParse,
  ObjectEntries,
  ObjectFreeze,
  ObjectKeys,
  RegExp: RegExpCtor,
  RegExpPrototypeExec,
  RegExpPrototypeTest,
  String: StringCtor,
  StringPrototypeEndsWith,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeMatch,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeTrim,
} = primordials;

class ManifestError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ManifestError';
    this.code = code;
  }
}

// Supported file patterns
const MANIFEST_PATTERNS = ObjectFreeze({
  __proto__: null,
  'package.json': { ecosystem: 'npm', type: 'manifest' },
  'composer.json': { ecosystem: 'composer', type: 'manifest' },
});

const LOCKFILE_PATTERNS = ObjectFreeze({
  __proto__: null,
  'package-lock.json': { ecosystem: 'npm', format: 'npm', type: 'lockfile' },
  'npm-shrinkwrap.json': { ecosystem: 'npm', format: 'npm', type: 'lockfile' },
  'yarn.lock': { ecosystem: 'npm', format: 'yarn', type: 'lockfile' },
  'pnpm-lock.yaml': { ecosystem: 'npm', format: 'pnpm', type: 'lockfile' },
  'composer.lock': { ecosystem: 'composer', format: 'composer', type: 'lockfile' },
});

const supportedFiles = ObjectFreeze({
  __proto__: null,
  manifests: ObjectFreeze(ObjectKeys(MANIFEST_PATTERNS)),
  lockfiles: ObjectFreeze(ObjectKeys(LOCKFILE_PATTERNS)),
});

// Detect format from filename
function detectFormat(filename) {
  const basename = filename.split('/').pop();

  if (MANIFEST_PATTERNS[basename]) {
    return { ...MANIFEST_PATTERNS[basename] };
  }
  if (LOCKFILE_PATTERNS[basename]) {
    return { ...LOCKFILE_PATTERNS[basename] };
  }

  return null;
}

// Parse package.json
function parsePackageJson(content) {
  let data;
  try {
    data = JSONParse(content);
  } catch (e) {
    throw new ManifestError(`Invalid JSON: ${e.message}`, 'ERR_INVALID_JSON');
  }

  const dependencies = [];

  // Helper to add deps
  const addDeps = (obj, type) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [name, range] of ObjectEntries(obj)) {
      ArrayPrototypePush(dependencies, ObjectFreeze({
        __proto__: null,
        name,
        versionRange: range,
        type,
        optional: type === 'optional',
      }));
    }
  };

  addDeps(data.dependencies, 'prod');
  addDeps(data.devDependencies, 'dev');
  addDeps(data.peerDependencies, 'peer');
  addDeps(data.optionalDependencies, 'optional');

  return ObjectFreeze({
    __proto__: null,
    type: 'manifest',
    name: data.name || null,
    version: data.version || null,
    description: data.description || null,
    license: data.license || null,
    repository: typeof data.repository === 'string' ? data.repository :
      data.repository?.url || null,
    dependencies: ObjectFreeze(dependencies),
    ecosystem: 'npm',
  });
}

// Parse git URL from resolved field (P0.3: Git dependency detection)
function parseGitUrl(resolved) {
  // Check if this is a git URL
  if (!StringPrototypeIndexOf(resolved, 'git+') === 0 &&
      !StringPrototypeIndexOf(resolved, 'git://') === 0) {
    return null;
  }

  // Extract URL and commit
  const hashIndex = StringPrototypeIndexOf(resolved, '#');
  if (hashIndex === -1) {
    // No commit hash
    return { url: resolved, commit: null };
  }

  const url = StringPrototypeSlice(resolved, 0, hashIndex);
  const commit = StringPrototypeSlice(resolved, hashIndex + 1);

  return { url, commit };
}

// Extract package name from node_modules path
function extractPackageNameFromPath(pkgPath) {
  // Find the last occurrence of node_modules to handle nested paths
  // e.g., "node_modules/a/node_modules/b/node_modules/c" -> "c"
  const lastNmIdx = StringPrototypeLastIndexOf(pkgPath, 'node_modules/');
  if (lastNmIdx === -1) {
    return pkgPath;
  }

  const withoutPrefix = StringPrototypeSlice(pkgPath, lastNmIdx + 13); // 'node_modules/'.length

  // Handle scoped packages (@scope/name)
  if (withoutPrefix[0] === '@') {
    const parts = StringPrototypeSplit(withoutPrefix, '/');
    // Validate scoped package format has both scope and name
    if (parts.length < 2) {
      return withoutPrefix;
    }
    return `${parts[0]}/${parts[1]}`;
  }

  // Regular packages - take first part before any /
  const firstSlash = StringPrototypeIndexOf(withoutPrefix, '/');
  if (firstSlash === -1) {
    return withoutPrefix;
  }
  return StringPrototypeSlice(withoutPrefix, 0, firstSlash);
}

// Parse package-lock.json
function parsePackageLock(content) {
  let data;
  try {
    data = JSONParse(content);
  } catch (e) {
    throw new ManifestError(`Invalid JSON: ${e.message}`, 'ERR_INVALID_JSON');
  }

  const packages = [];
  const packageIndex = { __proto__: null };

  // v2/v3 format uses "packages"
  if (data.packages) {
    for (const [path, pkg] of ObjectEntries(data.packages)) {
      // Skip root package
      if (path === '') continue;

      // Extract name from path using proper scoped package handling
      const name = extractPackageNameFromPath(path);
      const version = pkg.version || '0.0.0';

      // P0.3: Git dependency detection
      let vcsUrl = null;
      let vcsCommit = null;
      if (pkg.resolved) {
        const gitMatch = parseGitUrl(pkg.resolved);
        if (gitMatch) {
          vcsUrl = gitMatch.url;
          vcsCommit = gitMatch.commit;
        }
      }

      const ref = ObjectFreeze({
        __proto__: null,
        name,
        version,
        resolved: pkg.resolved || null,
        integrity: pkg.integrity || null,
        ecosystem: 'npm',
        depType: pkg.dev ? 'dev' : pkg.optional ? 'optional' : pkg.peer ? 'peer' : 'prod',
        isDev: !!pkg.dev,
        isOptional: !!pkg.optional,
        isPeer: !!pkg.peer,
        isBundled: !!pkg.inBundle,
        license: pkg.license || null,
        vcsUrl,
        vcsCommit,
        dependencies: pkg.dependencies ? ObjectKeys(pkg.dependencies) : [],
      });

      ArrayPrototypePush(packages, ref);
      packageIndex[name] = packages.length - 1;
    }
  }
  // v1 format uses "dependencies"
  else if (data.dependencies) {
    const visited = new Set();
    const flatten = (deps, path = '') => {
      for (const [name, pkg] of ObjectEntries(deps)) {
        const version = pkg.version || '0.0.0';
        const key = `${name}@${version}`;

        // Skip if already visited (prevents infinite recursion on circular deps)
        if (visited.has(key)) {
          continue;
        }

        // Only add if not already present (first occurrence wins)
        if (packageIndex[name] === undefined) {
          // P0.3: Git dependency detection
          let vcsUrl = null;
          let vcsCommit = null;
          if (pkg.resolved) {
            const gitMatch = parseGitUrl(pkg.resolved);
            if (gitMatch) {
              vcsUrl = gitMatch.url;
              vcsCommit = gitMatch.commit;
            }
          }

          const ref = ObjectFreeze({
            __proto__: null,
            name,
            version,
            resolved: pkg.resolved || null,
            integrity: pkg.integrity || null,
            ecosystem: 'npm',
            depType: pkg.dev ? 'dev' : pkg.optional ? 'optional' : pkg.peer ? 'peer' : 'prod',
            isDev: !!pkg.dev,
            isOptional: !!pkg.optional,
            isPeer: !!pkg.peer,
            isBundled: !!pkg.inBundle,
            vcsUrl,
            vcsCommit,
            dependencies: pkg.requires ? ObjectKeys(pkg.requires) : [],
          });

          ArrayPrototypePush(packages, ref);
          packageIndex[name] = packages.length - 1;
        }

        // Recursively flatten nested dependencies
        if (pkg.dependencies) {
          visited.add(key);
          flatten(pkg.dependencies, `${path}/${name}`);
          visited.delete(key);
        }
      }
    };
    flatten(data.dependencies);
  }

  return ObjectFreeze({
    __proto__: null,
    type: 'lockfile',
    lockVersion: StringCtor(data.lockfileVersion || 1),
    ecosystem: 'npm',
    packages: ObjectFreeze(packages),
    _index: packageIndex,
  });
}

// Parse yarn.lock descriptor (Classic and Berry)
function parseYarnDescriptor(descriptor) {
  // Handle Yarn Berry protocols (patch:, portal:, workspace:)
  if (StringPrototypeIndexOf(descriptor, 'patch:') === 0) {
    // Extract the package name after 'patch:' and before '@npm:' or '@workspace:'
    const afterPatch = StringPrototypeSlice(descriptor, 6); // 'patch:'.length
    let npmIndex = StringPrototypeIndexOf(afterPatch, '@npm:');
    const npmEncodedIndex = StringPrototypeIndexOf(afterPatch, '@npm%3A');
    const workspaceIndex = StringPrototypeIndexOf(afterPatch, '@workspace:');

    // Use the first valid occurrence
    if (npmEncodedIndex > 0 && (npmIndex === -1 || npmEncodedIndex < npmIndex)) {
      npmIndex = npmEncodedIndex;
    }

    if (npmIndex > 0) {
      return { name: StringPrototypeSlice(afterPatch, 0, npmIndex) };
    }
    if (workspaceIndex > 0) {
      return { name: StringPrototypeSlice(afterPatch, 0, workspaceIndex) };
    }
  }

  // Handle standard Berry descriptors with @npm: or @workspace:
  let protocolIndex = StringPrototypeIndexOf(descriptor, '@npm:');
  if (protocolIndex > 0) {
    return { name: StringPrototypeSlice(descriptor, 0, protocolIndex) };
  }

  protocolIndex = StringPrototypeIndexOf(descriptor, '@workspace:');
  if (protocolIndex > 0) {
    return { name: StringPrototypeSlice(descriptor, 0, protocolIndex) };
  }

  // Fallback: use last @ as separator (Classic Yarn)
  const atIdx = StringPrototypeLastIndexOf(descriptor, '@');
  if (atIdx > 0) {
    return { name: StringPrototypeSlice(descriptor, 0, atIdx) };
  }

  // If no @ found, return the whole descriptor as name
  return { name: descriptor };
}

// Parse yarn.lock (supports v1 Classic and v2+ Berry formats)
// Aligned with socket-sbom-generator gold standard
function parseYarnLock(content) {
  const packages = [];
  const packageIndex = { __proto__: null };

  // Detect Berry format by __metadata field
  const isBerry = StringPrototypeIndexOf(content, '__metadata:') !== -1;

  // Remove comments
  const lines = StringPrototypeSplit(content, '\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines and comments
    if (!line || StringPrototypeTrim(line) === '' || line[0] === '#') {
      i++;
      continue;
    }

    // Skip __metadata in Berry
    if (StringPrototypeTrim(line) === '__metadata:') {
      // Skip until next top-level entry
      i++;
      while (i < lines.length && (lines[i][0] === ' ' || lines[i][0] === '\t')) {
        i++;
      }
      continue;
    }

    // Package declaration (starts at column 0, optionally quoted, ends with :)
    if (line[0] !== ' ' && line[0] !== '\t' && StringPrototypeEndsWith(StringPrototypeTrim(line), ':')) {
      const spec = StringPrototypeTrim(StringPrototypeSlice(line, 0, -1));

      // Skip workspace entries in Berry (linkType: soft)
      let isWorkspace = false;
      let linkType = null;

      // Extract package name
      let name = spec;
      // Remove quotes
      name = StringPrototypeReplace(StringPrototypeReplace(name, /^"/, ''), /"$/, '');

      // Handle multiple specs: "name@^1.0.0, name@^1.1.0"
      const commaIdx = StringPrototypeIndexOf(name, ',');
      if (commaIdx !== -1) {
        name = StringPrototypeTrim(StringPrototypeSlice(name, 0, commaIdx));
      }

      // Skip workspace: protocol entries
      if (StringPrototypeIndexOf(name, '@workspace:') !== -1) {
        i++;
        while (i < lines.length && (lines[i][0] === ' ' || lines[i][0] === '\t')) {
          i++;
        }
        continue;
      }

      // Parse descriptor
      const parsed = parseYarnDescriptor(name);
      name = parsed.name;

      let version = null;
      let resolved = null;
      let integrity = null;
      let checksum = null;
      let dependencies = [];
      let isOptional = false;

      // Parse indented properties
      i++;
      while (i < lines.length && (lines[i][0] === ' ' || lines[i][0] === '\t')) {
        const propLine = StringPrototypeTrim(lines[i]);

        // Check for "version" with space or colon after
        if (StringPrototypeIndexOf(propLine, 'version ') === 0 ||
            StringPrototypeIndexOf(propLine, 'version:') === 0) {
          let colonIdx = StringPrototypeIndexOf(propLine, ':');
          if (colonIdx === -1) {
            // Space-separated format: "version \"4.17.21\""
            version = StringPrototypeReplace(StringPrototypeReplace(
              StringPrototypeTrim(StringPrototypeSlice(propLine, 8)), /^"/, ''), /"$/, '');
          } else {
            // Colon format: "version: \"4.17.21\""
            version = StringPrototypeReplace(StringPrototypeReplace(
              StringPrototypeTrim(StringPrototypeSlice(propLine, colonIdx + 1)), /^"/, ''), /"$/, '');
          }
        } else if (StringPrototypeIndexOf(propLine, 'resolved ') === 0 ||
                   StringPrototypeIndexOf(propLine, 'resolved:') === 0) {
          let colonIdx = StringPrototypeIndexOf(propLine, ':');
          if (colonIdx === -1) {
            // Space-separated format: "resolved \"https://...\""
            resolved = StringPrototypeReplace(StringPrototypeReplace(
              StringPrototypeTrim(StringPrototypeSlice(propLine, 9)), /^"/, ''), /"$/, '');
          } else {
            // Colon format: "resolved: \"https://...\""
            resolved = StringPrototypeReplace(StringPrototypeReplace(
              StringPrototypeTrim(StringPrototypeSlice(propLine, colonIdx + 1)), /^"/, ''), /"$/, '');
          }
        } else if (StringPrototypeIndexOf(propLine, 'integrity ') === 0 ||
                   StringPrototypeIndexOf(propLine, 'integrity:') === 0) {
          let colonIdx = StringPrototypeIndexOf(propLine, ':');
          if (colonIdx === -1) {
            // Space-separated format: "integrity sha512-..."
            integrity = StringPrototypeTrim(StringPrototypeSlice(propLine, 10));
          } else {
            // Colon format: "integrity: sha512-..."
            integrity = StringPrototypeTrim(StringPrototypeSlice(propLine, colonIdx + 1));
          }
        } else if (StringPrototypeIndexOf(propLine, 'checksum ') === 0 ||
                   StringPrototypeIndexOf(propLine, 'checksum:') === 0) {
          let colonIdx = StringPrototypeIndexOf(propLine, ':');
          if (colonIdx === -1) {
            // Space-separated
            checksum = StringPrototypeTrim(StringPrototypeSlice(propLine, 9));
          } else {
            // Colon format
            checksum = StringPrototypeTrim(StringPrototypeSlice(propLine, colonIdx + 1));
          }
        } else if (StringPrototypeIndexOf(propLine, 'linkType') === 0) {
          const colonIdx = StringPrototypeIndexOf(propLine, ':');
          if (colonIdx > 0) {
            linkType = StringPrototypeTrim(StringPrototypeSlice(propLine, colonIdx + 1));
          }
        } else if (StringPrototypeIndexOf(propLine, 'resolution') === 0) {
          // Berry resolution field
          const colonIdx = StringPrototypeIndexOf(propLine, ':');
          if (colonIdx > 0) {
            const resValue = StringPrototypeReplace(StringPrototypeReplace(
              StringPrototypeTrim(StringPrototypeSlice(propLine, colonIdx + 1)), /^"/, ''), /"$/, '');
            // Check if it's a URL
            if (StringPrototypeIndexOf(resValue, 'http://') === 0 ||
                StringPrototypeIndexOf(resValue, 'https://') === 0) {
              resolved = resValue;
            }
          }
        } else if (StringPrototypeIndexOf(propLine, 'dependencies:') === 0) {
          // Parse dependencies section
          i++;
          while (i < lines.length && lines[i][0] === ' ' && lines[i][1] === ' ' && lines[i][2] === ' ' && lines[i][3] === ' ') {
            const depLine = StringPrototypeTrim(lines[i]);
            const colonIdx = StringPrototypeIndexOf(depLine, ':');
            if (colonIdx > 0) {
              const depName = StringPrototypeSlice(depLine, 0, colonIdx);
              ArrayPrototypePush(dependencies, depName);
            }
            i++;
          }
          continue;
        } else if (StringPrototypeIndexOf(propLine, 'dependenciesMeta:') === 0) {
          // Check for optional dependencies in Berry
          i++;
          while (i < lines.length && lines[i][0] === ' ' && lines[i][1] === ' ' && lines[i][2] === ' ' && lines[i][3] === ' ') {
            const metaLine = StringPrototypeTrim(lines[i]);
            if (StringPrototypeIndexOf(metaLine, 'optional:') !== -1 &&
                StringPrototypeIndexOf(metaLine, 'true') !== -1) {
              isOptional = true;
            }
            i++;
          }
          continue;
        }

        i++;
      }

      // Skip workspace soft links in Berry
      if (isBerry && linkType === 'soft') {
        continue;
      }

      if (name && version) {
        const ref = ObjectFreeze({
          __proto__: null,
          name,
          version,
          resolved,
          integrity: integrity || checksum || null,
          ecosystem: 'npm',
          depType: 'prod',
          isDev: false,
          isOptional,
          dependencies,
        });

        ArrayPrototypePush(packages, ref);
        packageIndex[name] = packages.length - 1;
      }

      continue;
    }

    i++;
  }

  return ObjectFreeze({
    __proto__: null,
    type: 'lockfile',
    lockVersion: isBerry ? 'berry' : '1',
    ecosystem: 'npm',
    packages: ObjectFreeze(packages),
    _index: packageIndex,
  });
}

// Detect pnpm lockfile version from content
function detectPnpmVersion(content) {
  const match = RegExpPrototypeExec(/lockfileVersion:\s*['"]?([0-9.]+)['"]?/, content);
  if (match) {
    const version = match[1];
    if (version[0] === '5') return 5;
    if (version[0] === '6') return 6;
    if (version[0] === '9') return 9;
  }
  // Default to v9 (latest)
  return 9;
}

// Parse pnpm v5 package ID: /name/version or /@scope/name/version
function parsePnpmPackageIdV5(pkgId) {
  // Remove leading slash
  const withoutSlash = pkgId[0] === '/' ? StringPrototypeSlice(pkgId, 1) : pkgId;

  // Handle peer dependency suffix (strip everything after "_")
  const underscoreIdx = StringPrototypeIndexOf(withoutSlash, '_');
  const withoutPeerSuffix = underscoreIdx !== -1 ?
    StringPrototypeSlice(withoutSlash, 0, underscoreIdx) : withoutSlash;

  // Handle scoped packages: @scope/name/version
  if (withoutPeerSuffix[0] === '@') {
    const parts = StringPrototypeSplit(withoutPeerSuffix, '/');
    if (parts.length < 2) {
      return { name: withoutPeerSuffix, version: '0.0.0' };
    }
    const name = `${parts[0]}/${parts[1]}`;
    const version = parts[2] || '0.0.0';
    return { name, version };
  }

  // Regular packages: name/version
  const parts = StringPrototypeSplit(withoutPeerSuffix, '/');
  const name = parts[0] || withoutPeerSuffix;
  const version = parts[1] || '0.0.0';
  return { name, version };
}

// Parse pnpm v6/v9 package ID: name@version or @scope/name@version
function parsePnpmPackageIdV6V9(pkgId) {
  // Handle peer dependency suffix (strip everything after "(")
  const parenIdx = StringPrototypeIndexOf(pkgId, '(');
  const withoutPeerSuffix = parenIdx !== -1 ?
    StringPrototypeSlice(pkgId, 0, parenIdx) : pkgId;

  // Handle scoped packages: @scope/name@version
  if (withoutPeerSuffix[0] === '@') {
    // Find the last @ which separates version
    const lastAtIdx = StringPrototypeLastIndexOf(withoutPeerSuffix, '@');
    if (lastAtIdx > 0) {
      const name = StringPrototypeSlice(withoutPeerSuffix, 0, lastAtIdx);
      const version = StringPrototypeSlice(withoutPeerSuffix, lastAtIdx + 1);
      return { name, version };
    }
  } else {
    // Regular package: name@version
    const atIdx = StringPrototypeIndexOf(withoutPeerSuffix, '@');
    if (atIdx > 0) {
      const name = StringPrototypeSlice(withoutPeerSuffix, 0, atIdx);
      const version = StringPrototypeSlice(withoutPeerSuffix, atIdx + 1);
      return { name, version };
    }
  }

  // Fallback
  return { name: pkgId, version: '0.0.0' };
}

// Parse pnpm-lock.yaml (supports v5, v6, and v9 formats)
// Aligned with socket-sbom-generator gold standard
// P1.7: Includes workspace/monorepo support via importers
function parsePnpmLock(content) {
  const packages = [];
  const packageIndex = { __proto__: null };

  const lockVersion = detectPnpmVersion(content);
  const isV5 = lockVersion === 5;

  const lines = StringPrototypeSplit(content, '\n');
  let inPackages = false;
  let inSnapshots = false;
  let inImporters = false;
  let currentPkg = null;
  let currentIndent = 0;
  let currentImporter = null;
  let importerIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = StringPrototypeTrim(line);

    // Detect packages section (v5, v6)
    if (trimmed === 'packages:') {
      inPackages = true;
      inSnapshots = false;
      inImporters = false;
      continue;
    }

    // Detect snapshots section (v9)
    if (trimmed === 'snapshots:') {
      inSnapshots = true;
      inPackages = false;
      inImporters = false;
      continue;
    }

    // Detect importers section (workspace/monorepo support)
    if (trimmed === 'importers:') {
      inImporters = true;
      inPackages = false;
      inSnapshots = false;
      continue;
    }

    // New top-level section ends current section
    if (line[0] !== ' ' && line[0] !== '\t' && trimmed.length > 0 &&
        trimmed !== 'packages:' && trimmed !== 'snapshots:' && trimmed !== 'importers:') {
      inPackages = false;
      inSnapshots = false;
      inImporters = false;
      continue;
    }

    // P1.7: Parse importers section for workspace dependencies
    if (inImporters) {
      // Calculate indent level
      let indent = 0;
      while (indent < line.length && (line[indent] === ' ' || line[indent] === '\t')) {
        indent++;
      }

      // Importer entry (workspace path)
      if (indent === 2 && StringPrototypeEndsWith(trimmed, ':')) {
        currentImporter = { dependencies: null, devDependencies: null, optionalDependencies: null };
        importerIndent = indent;
        continue;
      }

      // Importer properties
      if (currentImporter && indent > importerIndent) {
        if (StringPrototypeIndexOf(trimmed, 'dependencies:') === 0) {
          currentImporter.dependencies = {};
        } else if (StringPrototypeIndexOf(trimmed, 'devDependencies:') === 0) {
          currentImporter.devDependencies = {};
        } else if (StringPrototypeIndexOf(trimmed, 'optionalDependencies:') === 0) {
          currentImporter.optionalDependencies = {};
        } else if (indent > importerIndent + 2) {
          // Dependency entry: "    name: version"
          const colonIdx = StringPrototypeIndexOf(trimmed, ':');
          if (colonIdx > 0) {
            const depName = StringPrototypeSlice(trimmed, 0, colonIdx);
            const depVersion = StringPrototypeTrim(StringPrototypeSlice(trimmed, colonIdx + 1));

            // Skip workspace links
            if (StringPrototypeIndexOf(depVersion, 'link:') === 0) {
              continue;
            }

            // Parse version (handle peer dep suffix)
            const version = StringPrototypeSplit(depVersion, '_')[0] || depVersion;
            const versionWithoutPeer = StringPrototypeSplit(version, '(')[0] || version;

            const key = `${depName}@${versionWithoutPeer}`;

            // Add to packages if not already present
            if (!packageIndex[depName]) {
              const ref = ObjectFreeze({
                __proto__: null,
                name: depName,
                version: versionWithoutPeer,
                resolved: null,
                integrity: null,
                ecosystem: 'npm',
                depType: currentImporter.devDependencies ? 'dev' :
                         currentImporter.optionalDependencies ? 'optional' : 'prod',
                isDev: !!currentImporter.devDependencies,
                isOptional: !!currentImporter.optionalDependencies,
                dependencies: [],
              });

              ArrayPrototypePush(packages, ref);
              packageIndex[depName] = packages.length - 1;
            }
          }
        }
      }
      continue;
    }

    if (!inPackages && !inSnapshots) continue;

    // Calculate indent level
    let indent = 0;
    while (indent < line.length && (line[indent] === ' ' || line[indent] === '\t')) {
      indent++;
    }

    // Package entry detection
    // v5: starts with / (e.g., "  /lodash/4.17.21:")
    // v6/v9: package@version (e.g., "  lodash@4.17.21:")
    const isPackageEntry = indent >= 2 && indent <= 4 &&
      StringPrototypeEndsWith(trimmed, ':') && trimmed.length > 1;

    if (isPackageEntry) {
      // Save previous package
      if (currentPkg && currentPkg.name) {
        const ref = ObjectFreeze({ __proto__: null, ...currentPkg });
        ArrayPrototypePush(packages, ref);
        if (!packageIndex[currentPkg.name]) {
          packageIndex[currentPkg.name] = packages.length - 1;
        }
      }

      // Parse package key
      const key = StringPrototypeSlice(trimmed, 0, trimmed.length - 1); // Remove trailing :

      let parsed;
      if (isV5 && key[0] === '/') {
        parsed = parsePnpmPackageIdV5(key);
      } else if (key[0] === '/') {
        // V5-style entry even in non-v5 lockfile
        parsed = parsePnpmPackageIdV5(key);
      } else {
        parsed = parsePnpmPackageIdV6V9(key);
      }

      currentPkg = {
        name: parsed.name,
        version: parsed.version,
        resolved: null,
        integrity: null,
        ecosystem: 'npm',
        depType: 'prod',
        isDev: false,
        isOptional: false,
        dependencies: [],
      };
      currentIndent = indent;
      continue;
    }

    // Properties (more indented than package entry)
    if (currentPkg && indent > currentIndent) {
      if (StringPrototypeIndexOf(trimmed, 'dev:') === 0) {
        if (StringPrototypeIndexOf(trimmed, 'true') !== -1) {
          currentPkg.depType = 'dev';
          currentPkg.isDev = true;
        }
      } else if (StringPrototypeIndexOf(trimmed, 'optional:') === 0) {
        if (StringPrototypeIndexOf(trimmed, 'true') !== -1) {
          currentPkg.depType = 'optional';
          currentPkg.isOptional = true;
        }
      } else if (StringPrototypeIndexOf(trimmed, 'integrity:') === 0) {
        currentPkg.integrity = StringPrototypeTrim(StringPrototypeSlice(trimmed, 10));
      } else if (StringPrototypeIndexOf(trimmed, 'resolution:') === 0) {
        // resolution: {integrity: sha512-...}
        const intMatch = RegExpPrototypeExec(/integrity:\s*([a-zA-Z0-9+/=-]+)/, trimmed);
        if (intMatch) {
          currentPkg.integrity = intMatch[1];
        }
        // Also check for tarball URL
        const tarballMatch = RegExpPrototypeExec(/tarball:\s*['"]?([^'"}\s]+)['"]?/, trimmed);
        if (tarballMatch) {
          currentPkg.resolved = tarballMatch[1];
        }
      } else if (StringPrototypeIndexOf(trimmed, 'dependencies:') === 0) {
        currentPkg.dependencies = [];
      } else if (currentPkg.dependencies && indent > currentIndent + 2) {
        // Dependency entry
        const colonIdx = StringPrototypeIndexOf(trimmed, ':');
        if (colonIdx > 0) {
          const depName = StringPrototypeSlice(trimmed, 0, colonIdx);
          ArrayPrototypePush(currentPkg.dependencies, depName);
        }
      }
    }
  }

  // Save last package
  if (currentPkg && currentPkg.name) {
    const ref = ObjectFreeze({ __proto__: null, ...currentPkg });
    ArrayPrototypePush(packages, ref);
    if (!packageIndex[currentPkg.name]) {
      packageIndex[currentPkg.name] = packages.length - 1;
    }
  }

  return ObjectFreeze({
    __proto__: null,
    type: 'lockfile',
    lockVersion: StringCtor(lockVersion),
    ecosystem: 'npm',
    packages: ObjectFreeze(packages),
    _index: packageIndex,
  });
}

// Parse manifest based on ecosystem
function parseManifest(content, ecosystem) {
  switch (ecosystem) {
    case 'npm':
      return parsePackageJson(content);
    default:
      throw new ManifestError(`Unsupported ecosystem: ${ecosystem}`, 'ERR_UNSUPPORTED');
  }
}

// Parse lockfile based on ecosystem and format
function parseLockfile(content, ecosystem, format) {
  switch (ecosystem) {
    case 'npm':
      switch (format) {
        case 'npm':
          return parsePackageLock(content);
        case 'yarn':
          return parseYarnLock(content);
        case 'pnpm':
          return parsePnpmLock(content);
        default:
          // Auto-detect
          if (StringPrototypeIndexOf(content, '"lockfileVersion"') !== -1) {
            return parsePackageLock(content);
          }
          if (StringPrototypeIndexOf(content, 'yarn lockfile') !== -1 ||
              StringPrototypeIndexOf(content, '__metadata:') !== -1) {
            return parseYarnLock(content);
          }
          if (StringPrototypeIndexOf(content, 'lockfileVersion:') !== -1) {
            return parsePnpmLock(content);
          }
          throw new ManifestError('Unable to detect lockfile format', 'ERR_UNKNOWN_FORMAT');
      }
    default:
      throw new ManifestError(`Unsupported ecosystem: ${ecosystem}`, 'ERR_UNSUPPORTED');
  }
}

// Auto-detect and parse
function parse(filename, content) {
  const format = detectFormat(filename);
  if (!format) {
    throw new ManifestError(`Unknown file format: ${filename}`, 'ERR_UNKNOWN_FORMAT');
  }

  if (format.type === 'manifest') {
    return parseManifest(content, format.ecosystem);
  } else {
    return parseLockfile(content, format.ecosystem, format.format);
  }
}

// Streaming parser (simplified - yields packages one by one)
async function* createStreamingParser(content, ecosystem) {
  // For now, just parse and yield - true streaming would require incremental parsing
  const result = parseLockfile(content, ecosystem);
  for (const pkg of result.packages) {
    yield pkg;
  }
}

// Analyze lockfile statistics
function analyzeLockfile(lockfile) {
  let prodDeps = 0;
  let devDeps = 0;
  let optionalDeps = 0;

  for (const pkg of lockfile.packages) {
    switch (pkg.depType) {
      case 'prod':
        prodDeps++;
        break;
      case 'dev':
        devDeps++;
        break;
      case 'optional':
        optionalDeps++;
        break;
    }
  }

  return ObjectFreeze({
    __proto__: null,
    totalPackages: lockfile.packages.length,
    prodDeps,
    devDeps,
    optionalDeps,
    byEcosystem: ObjectFreeze({ __proto__: null, [lockfile.ecosystem]: lockfile.packages.length }),
    maxDepth: 0, // Would require dependency tree analysis
    avgDepth: 0,
  });
}

// O(1) package lookup
function getPackage(lockfile, name) {
  const idx = lockfile._index?.[name];
  return idx !== undefined ? lockfile.packages[idx] : null;
}

// Find packages matching pattern
function findPackages(lockfile, pattern) {
  const regex = pattern instanceof RegExpCtor ? pattern : RegExpCtor(pattern);
  return ArrayPrototypeFilter(lockfile.packages, (pkg) => RegExpPrototypeTest(regex, pkg.name));
}

module.exports = {
  parse,
  parseManifest,
  parseLockfile,
  createStreamingParser,
  analyzeLockfile,
  getPackage,
  findPackages,
  detectFormat,
  supportedFiles,
  ManifestError,
};

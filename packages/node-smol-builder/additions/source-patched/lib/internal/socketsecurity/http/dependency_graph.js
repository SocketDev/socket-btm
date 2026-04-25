'use strict'

const {
  ArrayPrototypeFilter,
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  IteratorPrototypeNext,
  MapPrototypeClear,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeKeys,
  MapPrototypeSet,
  NumberIsNaN,
  ObjectKeys,
  PromiseAllSettled,
  PromisePrototypeThen,
  RegExpPrototypeTest,
  SafeMap,
  hardenRegExp,
} = primordials

// Npm package name grammar — same shape as http2_helpers.js. Dependency
// names originate from untrusted upstream packument data; without this
// filter a crafted key could inject CR/LF/`;`/`,` into the Link header.
const NPM_PACKAGE_NAME_REGEX = hardenRegExp(/^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/)

// Dependency graph precomputation for package installations.
// Preload/hint dependencies when client requests a package.
// 50-200ms latency reduction for full install.
// 30-50% fewer client requests (dependencies bundled).

class DependencyGraph {
  constructor(maxSize = 50_000) {
    this.cache = new SafeMap()
    this.maxSize = maxSize
    this.stats = {
      __proto__: null,
      cache_hits: 0,
      cache_misses: 0,
      graphs_computed: 0,
    }
  }

  // Compute dependency graph for package.
  async computeGraph(packageName, version, getPackument) {
    const key = `${packageName}@${version}`

    // Check cache first.
    const cached = MapPrototypeGet(this.cache, key)
    if (cached) {
      this.stats.cache_hits++
      return cached
    }

    this.stats.cache_misses++

    // Fetch packument.
    const packument = await getPackument(packageName)
    if (!packument || !packument.versions || !packument.versions[version]) {
      return { __proto__: null, dependencies: [], error: 'Version not found' }
    }

    // Extract dependencies.
    const versionData = packument.versions[version]
    const deps = versionData.dependencies || {}
    const devDeps = versionData.devDependencies || {}
    const peerDeps = versionData.peerDependencies || {}
    const optionalDeps = versionData.optionalDependencies || {}

    // Build graph.
    const graph = {
      __proto__: null,
      dependencies: ArrayPrototypeMap(ObjectKeys(deps), name => ({
        __proto__: null,
        name,
        range: deps[name],
        type: 'runtime',
      })),
      devDependencies: ArrayPrototypeMap(ObjectKeys(devDeps), name => ({
        __proto__: null,
        name,
        range: devDeps[name],
        type: 'dev',
      })),
      name: packageName,
      optionalDependencies: ArrayPrototypeMap(
        ObjectKeys(optionalDeps),
        name => ({
          __proto__: null,
          name,
          range: optionalDeps[name],
          type: 'optional',
        }),
      ),
      peerDependencies: ArrayPrototypeMap(ObjectKeys(peerDeps), name => ({
        __proto__: null,
        name,
        range: peerDeps[name],
        type: 'peer',
      })),
      version,
    }

    // Cache graph.
    MapPrototypeSet(this.cache, key, graph)
    this.stats.graphs_computed++

    // Evict oldest if at capacity.
    if (this.cache.size > this.maxSize) {
      const { value: firstKey } = IteratorPrototypeNext(
        MapPrototypeKeys(this.cache),
      )
      if (firstKey !== undefined) {
        MapPrototypeDelete(this.cache, firstKey)
      }
    }

    return graph
  }

  // Get direct dependencies for Link preload headers.
  getDependenciesForPreload(graph, includeTypes = ['runtime']) {
    const deps = []

    if (ArrayPrototypeIncludes(includeTypes, 'runtime')) {
      ArrayPrototypePush(deps, ...graph.dependencies)
    }
    if (ArrayPrototypeIncludes(includeTypes, 'dev')) {
      ArrayPrototypePush(deps, ...graph.devDependencies)
    }
    if (ArrayPrototypeIncludes(includeTypes, 'peer')) {
      ArrayPrototypePush(deps, ...graph.peerDependencies)
    }
    if (ArrayPrototypeIncludes(includeTypes, 'optional')) {
      ArrayPrototypePush(deps, ...graph.optionalDependencies)
    }

    return ArrayPrototypeMap(deps, dep => dep.name)
  }

  // Bundle packument with dependency metadata.
  async bundleWithDependencies(packument, version, getPackument, maxDepth = 1) {
    const graph = await this.computeGraph(packument.name, version, getPackument)

    if (maxDepth === 0) {
      return { __proto__: null, package: packument, dependencies: [] }
    }

    // Fetch packuments for direct dependencies in parallel. Previously
    // this was a sequential for-await loop: N deps → N round-trips
    // back-to-back. For popular packages (react/next/lodash carry
    // 15-40 direct deps) that turned a ~50 ms single-round bundle into
    // a 1-2 s serial cascade, defeating the "50-200 ms install latency
    // reduction" claim in the file header.
    const dependencyPackuments = []
    const results = await PromiseAllSettled(
      ArrayPrototypeMap(graph.dependencies, dep =>
        PromisePrototypeThen(getPackument(dep.name), depPackument => ({
          __proto__: null,
          metadata: depPackument,
          name: dep.name,
          range: dep.range,
        })),
      ),
    )
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value.metadata) {
        ArrayPrototypePush(dependencyPackuments, r.value)
      }
    }

    return {
      __proto__: null,
      dependencies: dependencyPackuments,
      package: packument,
    }
  }

  // Generate Link preload headers. Filter dep names against npm grammar
  // so hostile packument keys (CR/LF/`;`/`,`/`>`) can't split the Link
  // header and inject fake headers into the HTTP/2 response.
  generateLinkHeaders(dependencies) {
    const safe = ArrayPrototypeFilter(dependencies, dep =>
      typeof dep === 'string' &&
      RegExpPrototypeTest(NPM_PACKAGE_NAME_REGEX, dep),
    )
    return ArrayPrototypeJoin(
      ArrayPrototypeMap(
        safe,
        dep => `</${dep}>; rel=preload; as=fetch`,
      ),
      ', ',
    )
  }

  // Invalidate graph (on package update).
  invalidate(packageName, version) {
    const key = `${packageName}@${version}`
    MapPrototypeDelete(this.cache, key)
  }

  // Get statistics.
  getStats() {
    const hitRate =
      this.stats.cache_hits / (this.stats.cache_hits + this.stats.cache_misses)

    return {
      __proto__: null,
      cache_hits: this.stats.cache_hits,
      cache_misses: this.stats.cache_misses,
      cache_size: this.cache.size,
      graphs_computed: this.stats.graphs_computed,
      hit_rate: NumberIsNaN(hitRate) ? 0 : hitRate,
      max_size: this.maxSize,
    }
  }

  // Clear cache.
  clear() {
    MapPrototypeClear(this.cache)
  }
}

// Lazy global dependency graph instance.
let _globalDependencyGraph
function getDependencyGraph() {
  if (!_globalDependencyGraph) {
    _globalDependencyGraph = new DependencyGraph()
  }
  return _globalDependencyGraph
}

module.exports = {
  __proto__: null,
  DependencyGraph,
  get dependencyGraph() {
    return getDependencyGraph()
  },
}

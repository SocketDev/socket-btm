'use strict';

const {
  ArrayFrom,
  MapPrototypeClear,
  MapPrototypeDelete,
  MapPrototypeEntries,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeKeys,
  MapPrototypeSet,
  SafeMap,
  SafeSet,
  SetPrototypeAdd,
  SetPrototypeDelete,
  SetPrototypeForEach,
  SetPrototypeHas,
} = primordials;

// Cross-ecosystem package indexing.
// Unified search and discovery across multiple package formats.
//
// Features:
// - Normalized package identifiers
// - Cross-format search
// - Shared metadata cache

const crypto = require('crypto');

// Package identifier normalization.
class PackageIdentifier {
  // Normalize package name across ecosystems.
  static normalize(ecosystem, name) {
    // Remove ecosystem-specific prefixes/scopes.
    let normalized = name;

    // npm/yarn/pnpm: @scope/package → scope-package
    if (ecosystem === 'npm' || ecosystem === 'yarn' || ecosystem === 'pnpm') {
      // Convert @babel/core → babel-core (remove @ and replace / with -)
      normalized = name.replace(/^@/, '').replace(/\//g, '-');
    }

    // Maven: groupId:artifactId → artifactId
    if (ecosystem === 'maven' || ecosystem === 'gradle') {
      const parts = name.split(':');
      normalized = parts[parts.length - 1];
    }

    // Convert to lowercase.
    normalized = normalized.toLowerCase();

    // Remove special characters (except hyphens).
    normalized = normalized.replace(/[^a-z0-9-]/g, '-');

    return normalized;
  }

  // Generate unified identifier.
  static generate(ecosystem, name, version) {
    const normalized = PackageIdentifier.normalize(ecosystem, name);
    const hash = crypto
      .createHash('sha256')
      .update(`${ecosystem}:${name}:${version}`)
      .digest('hex')
      .substring(0, 8);

    return `${normalized}-${hash}`;
  }
}

// Cross-ecosystem index.
class CrossEcosystemIndex {
  constructor(maxSize = 100_000) {
    this.index = new SafeMap();
    this.reverseIndex = new SafeMap();
    this.maxSize = maxSize;
    this.stats = {
      __proto__: null,
      cross_ecosystem_searches: 0,
      indexed_packages: 0,
      shared_packages: 0,
    };
  }

  // Index a package.
  indexPackage(ecosystem, name, version, metadata) {
    const id = PackageIdentifier.generate(ecosystem, name, version);
    const normalized = PackageIdentifier.normalize(ecosystem, name);

    // Add to main index.
    if (!MapPrototypeHas(this.index, id)) {
      MapPrototypeSet(this.index, id, {
        __proto__: null,
        ecosystem,
        metadata,
        name,
        normalized,
        version,
      });
      this.stats.indexed_packages++;
    }

    // Add to reverse index (normalized → IDs).
    if (!MapPrototypeHas(this.reverseIndex, normalized)) {
      MapPrototypeSet(this.reverseIndex, normalized, new SafeSet());
    }
    SetPrototypeAdd(MapPrototypeGet(this.reverseIndex, normalized), id);

    // Check if package exists in multiple ecosystems.
    if (MapPrototypeGet(this.reverseIndex, normalized).size > 1) {
      this.stats.shared_packages++;
    }

    // Evict oldest entries if at capacity.
    if (this.index.size > this.maxSize) {
      const firstId = MapPrototypeKeys(this.index).next().value;
      const firstEntry = MapPrototypeGet(this.index, firstId);
      MapPrototypeDelete(this.index, firstId);

      // Clean up reverse index.
      const normalizedSet = MapPrototypeGet(this.reverseIndex, firstEntry.normalized);
      if (normalizedSet) {
        SetPrototypeDelete(normalizedSet, firstId);
        if (normalizedSet.size === 0) {
          MapPrototypeDelete(this.reverseIndex, firstEntry.normalized);
        }
      }
    }
  }

  // Search across ecosystems.
  search(query) {
    this.stats.cross_ecosystem_searches++;

    // Normalize query consistently with PackageIdentifier.normalize.
    // Remove leading @, lowercase, replace special chars with -.
    let normalized = query.toLowerCase();
    normalized = normalized.replace(/^@/, '');
    normalized = normalized.replace(/[^a-z0-9-]/g, '-');
    const results = [];
    const seenIds = new SafeSet();

    // Exact match on normalized name.
    if (MapPrototypeHas(this.reverseIndex, normalized)) {
      SetPrototypeForEach(MapPrototypeGet(this.reverseIndex, normalized), (id) => {
        if (!SetPrototypeHas(seenIds, id)) {
          const entry = MapPrototypeGet(this.index, id);
          if (entry) {
            SetPrototypeAdd(seenIds, id);
            results.push(entry);
          }
        }
      });
    }

    // Partial match (always included for cross-ecosystem discovery).
    for (const [norm, ids] of MapPrototypeEntries(this.reverseIndex)) {
      if (norm !== normalized && norm.includes(normalized)) {
        SetPrototypeForEach(ids, (id) => {
          if (!SetPrototypeHas(seenIds, id)) {
            const entry = MapPrototypeGet(this.index, id);
            if (entry) {
              SetPrototypeAdd(seenIds, id);
              results.push(entry);
            }
          }
        });
      }
    }

    return results;
  }

  // Find package in specific ecosystem.
  find(ecosystem, name, version) {
    const id = PackageIdentifier.generate(ecosystem, name, version);
    return MapPrototypeGet(this.index, id);
  }

  // Get all ecosystems for a package.
  getEcosystems(normalizedName) {
    const ecosystems = new SafeSet();

    if (MapPrototypeHas(this.reverseIndex, normalizedName)) {
      SetPrototypeForEach(MapPrototypeGet(this.reverseIndex, normalizedName), (id) => {
        const entry = MapPrototypeGet(this.index, id);
        if (entry) {
          SetPrototypeAdd(ecosystems, entry.ecosystem);
        }
      });
    }

    return ArrayFrom(ecosystems);
  }

  // Get statistics.
  getStats() {
    return {
      __proto__: null,
      ...this.stats,
      index_size: this.index.size,
      normalized_packages: this.reverseIndex.size,
    };
  }

  // Clear index.
  clear() {
    MapPrototypeClear(this.index);
    MapPrototypeClear(this.reverseIndex);
    this.stats = {
      __proto__: null,
      cross_ecosystem_searches: 0,
      indexed_packages: 0,
      shared_packages: 0,
    };
  }
}

// Global cross-ecosystem index.
const globalCrossEcosystemIndex = new CrossEcosystemIndex();

module.exports = {
  __proto__: null,
  CrossEcosystemIndex,
  PackageIdentifier,
  crossEcosystemIndex: globalCrossEcosystemIndex,
};

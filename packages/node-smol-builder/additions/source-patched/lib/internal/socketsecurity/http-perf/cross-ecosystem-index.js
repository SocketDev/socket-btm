'use strict';

// Cross-ecosystem package indexing.
// Unified search and discovery across multiple package formats.
//
// Features:
// - Normalized package identifiers
// - Cross-format search
// - Shared metadata cache

const crypto = require('node:crypto');

// Package identifier normalization.
class PackageIdentifier {
  // Normalize package name across ecosystems.
  static normalize(ecosystem, name) {
    // Remove ecosystem-specific prefixes/scopes.
    let normalized = name;

    // npm: @scope/package → package
    if (ecosystem === 'npm' || ecosystem === 'yarn' || ecosystem === 'pnpm') {
      normalized = name.replace(/^@[^/]+\//, '');
    }

    // Maven: groupId:artifactId → artifactId
    if (ecosystem === 'maven' || ecosystem === 'gradle') {
      const parts = name.split(':');
      normalized = parts[parts.length - 1];
    }

    // Convert to lowercase.
    normalized = normalized.toLowerCase();

    // Remove special characters.
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
    this.index = new Map();
    this.reverseIndex = new Map();
    this.maxSize = maxSize;
    this.stats = {
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
    if (!this.index.has(id)) {
      this.index.set(id, {
        ecosystem,
        metadata,
        name,
        normalized,
        version,
      });
      this.stats.indexed_packages++;
    }

    // Add to reverse index (normalized → IDs).
    if (!this.reverseIndex.has(normalized)) {
      this.reverseIndex.set(normalized, new Set());
    }
    this.reverseIndex.get(normalized).add(id);

    // Check if package exists in multiple ecosystems.
    if (this.reverseIndex.get(normalized).size > 1) {
      this.stats.shared_packages++;
    }

    // Evict oldest entries if at capacity.
    if (this.index.size > this.maxSize) {
      const firstId = this.index.keys().next().value;
      const firstEntry = this.index.get(firstId);
      this.index.delete(firstId);

      // Clean up reverse index.
      const normalizedSet = this.reverseIndex.get(firstEntry.normalized);
      if (normalizedSet) {
        normalizedSet.delete(firstId);
        if (normalizedSet.size === 0) {
          this.reverseIndex.delete(firstEntry.normalized);
        }
      }
    }
  }

  // Search across ecosystems.
  search(query) {
    this.stats.cross_ecosystem_searches++;

    const normalized = query.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const results = [];

    // Exact match on normalized name.
    if (this.reverseIndex.has(normalized)) {
      for (const id of this.reverseIndex.get(normalized)) {
        const entry = this.index.get(id);
        if (entry) {
          results.push(entry);
        }
      }
    }

    // Partial match.
    if (results.length === 0) {
      for (const [norm, ids] of this.reverseIndex.entries()) {
        if (norm.includes(normalized)) {
          for (const id of ids) {
            const entry = this.index.get(id);
            if (entry) {
              results.push(entry);
            }
          }
        }
      }
    }

    return results;
  }

  // Find package in specific ecosystem.
  find(ecosystem, name, version) {
    const id = PackageIdentifier.generate(ecosystem, name, version);
    return this.index.get(id) || null;
  }

  // Get all ecosystems for a package.
  getEcosystems(normalizedName) {
    const ecosystems = new Set();

    if (this.reverseIndex.has(normalizedName)) {
      for (const id of this.reverseIndex.get(normalizedName)) {
        const entry = this.index.get(id);
        if (entry) {
          ecosystems.add(entry.ecosystem);
        }
      }
    }

    return Array.from(ecosystems);
  }

  // Get statistics.
  getStats() {
    return {
      ...this.stats,
      index_size: this.index.size,
      normalized_packages: this.reverseIndex.size,
    };
  }

  // Clear index.
  clear() {
    this.index.clear();
    this.reverseIndex.clear();
    this.stats = {
      cross_ecosystem_searches: 0,
      indexed_packages: 0,
      shared_packages: 0,
    };
  }
}

// Global cross-ecosystem index.
const globalCrossEcosystemIndex = new CrossEcosystemIndex();

module.exports = {
  CrossEcosystemIndex,
  PackageIdentifier,
  crossEcosystemIndex: globalCrossEcosystemIndex,
};

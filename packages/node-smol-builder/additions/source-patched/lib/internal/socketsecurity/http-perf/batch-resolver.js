'use strict';

const {
  ArrayFrom,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeSet,
  MapPrototypeValues,
  ObjectEntries,
  SafeMap,
  SafeSet,
  SetPrototypeAdd,
  SetPrototypeHas,
} = primordials;

// Batch package resolution API.
// Resolves multiple packages in a single request for optimal performance.
//
// Features:
// - Single-request resolution for entire dependency trees
// - Parallel package fetching with connection pooling
// - Deduplication of shared dependencies
// - Bundled response format

const crypto = require('crypto');

// Batch resolution request.
class BatchResolver {
  constructor(maxConcurrency = 50) {
    this.maxConcurrency = maxConcurrency;
    this.stats = {
      __proto__: null,
      batches_resolved: 0,
      deduplication_saved: 0,
      packages_fetched: 0,
    };
  }

  // Resolve batch of packages.
  async resolveBatch(packages, fetchPackage) {
    this.stats.batches_resolved++;

    // Handle null/empty packages.
    if (!packages || packages.length === 0) {
      return {
        __proto__: null,
        deduplication_saved: 0,
        errors: [],
        packages: [],
        total_requested: 0,
        total_unique: 0,
      };
    }

    // Deduplicate packages by name@version.
    const uniquePackages = this._deduplicatePackages(packages);
    const savedCount = packages.length - uniquePackages.length;
    this.stats.deduplication_saved += savedCount;

    // Fetch packages in parallel with concurrency limit.
    const results = await this._fetchWithConcurrency(
      uniquePackages,
      fetchPackage
    );

    this.stats.packages_fetched += uniquePackages.length;

    return {
      __proto__: null,
      deduplication_saved: savedCount,
      errors: results.errors,
      packages: results.resolved,
      total_requested: packages.length,
      total_unique: uniquePackages.length,
    };
  }

  // Deduplicate packages.
  _deduplicatePackages(packages) {
    const seen = new SafeSet();
    const unique = [];

    for (const pkg of packages) {
      const key = `${pkg.name}@${pkg.version}`;
      if (!SetPrototypeHas(seen, key)) {
        SetPrototypeAdd(seen, key);
        unique.push(pkg);
      }
    }

    return unique;
  }

  // Fetch packages with concurrency limit.
  async _fetchWithConcurrency(packages, fetchPackage) {
    const resolved = [];
    const errors = [];
    const chunks = [];

    // Split into chunks of maxConcurrency.
    for (let i = 0; i < packages.length; i += this.maxConcurrency) {
      chunks.push(packages.slice(i, i + this.maxConcurrency));
    }

    // Process chunks sequentially, items in parallel.
    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(pkg => fetchPackage(pkg.name, pkg.version))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const pkg = chunk[i];

        if (result.status === 'fulfilled') {
          resolved.push({
            __proto__: null,
            metadata: result.value,
            name: pkg.name,
            version: pkg.version,
          });
        } else {
          errors.push({
            __proto__: null,
            error: result.reason.message,
            name: pkg.name,
            version: pkg.version,
          });
        }
      }
    }

    return { __proto__: null, errors, resolved };
  }

  // Resolve with dependency graph expansion.
  async resolveWithDeps(rootPackages, fetchPackage, maxDepth = 3) {
    const allPackages = new SafeMap();
    const toProcess = [...rootPackages];
    let depth = 0;

    while (toProcess.length > 0 && depth < maxDepth) {
      const batch = toProcess.splice(0);

      // Resolve batch.
      const result = await this.resolveBatch(batch, fetchPackage);

      // Add resolved packages.
      for (const pkg of result.packages) {
        const key = `${pkg.name}@${pkg.version}`;
        if (!MapPrototypeHas(allPackages, key)) {
          MapPrototypeSet(allPackages, key, pkg);

          // Extract dependencies for next level.
          if (pkg.metadata && pkg.metadata.dependencies) {
            for (const [name, version] of ObjectEntries(pkg.metadata.dependencies)) {
              toProcess.push({ name, version });
            }
          }
        }
      }

      depth++;
    }

    return {
      __proto__: null,
      depth_reached: depth,
      packages: ArrayFrom(MapPrototypeValues(allPackages)),
      total: allPackages.size,
    };
  }

  // Get statistics.
  getStats() {
    return {
      __proto__: null,
      ...this.stats,
      avg_dedup_savings:
        this.stats.batches_resolved > 0
          ? (this.stats.deduplication_saved / this.stats.batches_resolved).toFixed(2)
          : '0.00',
    };
  }

  // Clear statistics.
  clearStats() {
    this.stats = {
      __proto__: null,
      batches_resolved: 0,
      deduplication_saved: 0,
      packages_fetched: 0,
    };
  }
}

// Global batch resolver instance.
const globalBatchResolver = new BatchResolver();

module.exports = {
  __proto__: null,
  BatchResolver,
  batchResolver: globalBatchResolver,
};

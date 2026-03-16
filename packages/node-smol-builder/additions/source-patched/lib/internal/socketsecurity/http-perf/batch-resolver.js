'use strict';

// Batch package resolution API.
// Resolves multiple packages in a single request for optimal performance.
//
// Features:
// - Single-request resolution for entire dependency trees
// - Parallel package fetching with connection pooling
// - Deduplication of shared dependencies
// - Bundled response format

const crypto = require('node:crypto');

// Batch resolution request.
class BatchResolver {
  constructor(maxConcurrency = 50) {
    this.maxConcurrency = maxConcurrency;
    this.stats = {
      batches_resolved: 0,
      deduplication_saved: 0,
      packages_fetched: 0,
    };
  }

  // Resolve batch of packages.
  async resolveBatch(packages, fetchPackage) {
    this.stats.batches_resolved++;

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
      deduplication_saved: savedCount,
      errors: results.errors,
      packages: results.resolved,
      total_requested: packages.length,
      total_unique: uniquePackages.length,
    };
  }

  // Deduplicate packages.
  _deduplicatePackages(packages) {
    const seen = new Set();
    const unique = [];

    for (const pkg of packages) {
      const key = `${pkg.name}@${pkg.version}`;
      if (!seen.has(key)) {
        seen.add(key);
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
            metadata: result.value,
            name: pkg.name,
            version: pkg.version,
          });
        } else {
          errors.push({
            error: result.reason.message,
            name: pkg.name,
            version: pkg.version,
          });
        }
      }
    }

    return { errors, resolved };
  }

  // Resolve with dependency graph expansion.
  async resolveWithDeps(rootPackages, fetchPackage, maxDepth = 3) {
    const allPackages = new Map();
    const toProcess = [...rootPackages];
    let depth = 0;

    while (toProcess.length > 0 && depth < maxDepth) {
      const batch = toProcess.splice(0);

      // Resolve batch.
      const result = await this.resolveBatch(batch, fetchPackage);

      // Add resolved packages.
      for (const pkg of result.packages) {
        const key = `${pkg.name}@${pkg.version}`;
        if (!allPackages.has(key)) {
          allPackages.set(key, pkg);

          // Extract dependencies for next level.
          if (pkg.metadata && pkg.metadata.dependencies) {
            for (const [name, version] of Object.entries(pkg.metadata.dependencies)) {
              toProcess.push({ name, version });
            }
          }
        }
      }

      depth++;
    }

    return {
      depth_reached: depth,
      packages: Array.from(allPackages.values()),
      total: allPackages.size,
    };
  }

  // Get statistics.
  getStats() {
    return {
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
      batches_resolved: 0,
      deduplication_saved: 0,
      packages_fetched: 0,
    };
  }
}

// Global batch resolver instance.
const globalBatchResolver = new BatchResolver();

module.exports = {
  BatchResolver,
  batchResolver: globalBatchResolver,
};

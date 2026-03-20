'use strict';

const {
  ObjectEntries,
  ObjectKeys,
} = primordials;

// Fast format detection for package registry requests.
// Optimized for high-throughput multi-format package serving.
//
// Supports detection via:
// - User-Agent header analysis
// - Request path patterns
// - Content-Type negotiation

// Format identifiers (generic naming for public code).
const FORMATS = {
  __proto__: null,
  bundler: 'bundler',
  cargo: 'cargo',
  composer: 'composer',
  conan: 'conan',
  go: 'go',
  gradle: 'gradle',
  maven: 'maven',
  npm: 'npm',
  nuget: 'nuget',
  pip: 'pip',
  pnpm: 'pnpm',
  poetry: 'poetry',
  sbt: 'sbt',
  swift: 'swift',
  uv: 'uv',
  yarn: 'yarn',
};

// User-Agent patterns for fast detection.
// Order matters: more specific patterns (pnpm) must come before less specific (npm).
const USER_AGENT_PATTERNS = {
  __proto__: null,
  // pnpm before npm (npm pattern would match pnpm otherwise).
  pnpm: /pnpm\/\d+\./i,
  npm: /(?<![p])npm\/\d+\./i,
  bundler: /bundler/i,
  cargo: /cargo[\s/]/i,
  composer: /composer\//i,
  go: /go-http-client|go-module|go\/\d+\./i,
  gradle: /gradle/i,
  maven: /maven|aether/i,
  nuget: /nuget/i,
  pip: /pip\/\d+\./i,
  poetry: /poetry/i,
  swift: /swift-package-manager/i,
  uv: /uv\/\d+\./i,
  yarn: /yarn\/\d+\./i,
};

// Path patterns for detection (case-insensitive).
const PATH_PATTERNS = {
  __proto__: null,
  bundler: /\/gems\/|\/api\/v1\/dependencies/i,
  cargo: /\/crates\//i,
  composer: /\/packages\.json|\/p2\//i,
  go: /\/@v\/|\/go\.mod/i,
  gradle: /\/maven2\/.*\.gradle/i,
  maven: /\/maven2\//i,
  nuget: /\/v3\/registration\/|\/v3\/index\.json|\/packages\//i,
  pip: /\/pypi\/|\/simple\//i,
};

// Fast format detection.
class FormatDetector {
  constructor() {
    this._initStats();
  }

  _initStats() {
    this.stats = {
      __proto__: null,
      detections: 0,
      path_based: 0,
      unknown: 0,
      user_agent_based: 0,
    };
    // Per-format detection counts.
    this._formatCounts = { __proto__: null };
    for (const format of ObjectKeys(FORMATS)) {
      this._formatCounts[format] = 0;
    }
  }

  // Detect format from request.
  detect(req) {
    this.stats.detections++;

    // Handle null/undefined request gracefully.
    if (!req) {
      this.stats.unknown++;
      return FORMATS.npm;
    }

    const path = req.url || '';
    const userAgent = (req.headers && req.headers['user-agent']) || '';

    // Fast path: User-Agent based detection.
    if (userAgent) {
      const format = this._detectFromUserAgent(userAgent);
      if (format) {
        this.stats.user_agent_based++;
        this._formatCounts[format]++;
        return format;
      }
    }

    // Path-based detection.
    const pathFormat = this._detectFromPath(path);
    if (pathFormat) {
      this.stats.path_based++;
      this._formatCounts[pathFormat]++;
      return pathFormat;
    }

    // Default to npm for unknown.
    this.stats.unknown++;
    return FORMATS.npm;
  }

  // Detect from User-Agent header.
  _detectFromUserAgent(userAgent) {
    // Fast check for common patterns.
    for (const [format, pattern] of ObjectEntries(USER_AGENT_PATTERNS)) {
      if (pattern.test(userAgent)) {
        return format;
      }
    }
    return null;
  }

  // Detect from request path.
  _detectFromPath(path) {
    for (const [format, pattern] of ObjectEntries(PATH_PATTERNS)) {
      if (pattern.test(path)) {
        return format;
      }
    }
    return null;
  }

  // Get detection statistics.
  getStats() {
    const { detections, user_agent_based, path_based } = this.stats;
    const result = {
      __proto__: null,
      total_detections: detections,
      user_agent_detections: user_agent_based,
      path_detections: path_based,
    };
    // Add per-format counts.
    for (const format of ObjectKeys(FORMATS)) {
      result[`${format}_detections`] = this._formatCounts[format];
    }
    return result;
  }

  // Clear statistics.
  clearStats() {
    this._initStats();
  }
}

// Global format detector instance.
const globalFormatDetector = new FormatDetector();

module.exports = {
  __proto__: null,
  FORMATS,
  FormatDetector,
  formatDetector: globalFormatDetector,
};

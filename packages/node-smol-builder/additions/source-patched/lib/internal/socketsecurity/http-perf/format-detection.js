'use strict';

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
  rubygems: 'rubygems',
  sbt: 'sbt',
  swift: 'swift',
  uv: 'uv',
  yarn: 'yarn',
};

// User-Agent patterns for fast detection.
const USER_AGENT_PATTERNS = {
  __proto__: null,
  cargo: /cargo\//i,
  composer: /composer\//i,
  go: /go-module|go\/\d+\./i,
  gradle: /gradle/i,
  maven: /maven|aether/i,
  npm: /npm\/\d+\./i,
  nuget: /nuget/i,
  pip: /pip\/\d+\./i,
  pnpm: /pnpm\/\d+\./i,
  poetry: /poetry/i,
  rubygems: /bundler|rubygems/i,
  swift: /swift-package-manager/i,
  uv: /uv\/\d+\./i,
  yarn: /yarn\/\d+\./i,
};

// Path patterns for detection.
const PATH_PATTERNS = {
  __proto__: null,
  cargo: /\/crates\//,
  composer: /\/packages\.json|\/p2\//,
  go: /\/@v\/|\/go\.mod/,
  gradle: /\/maven2\/.*\.gradle/,
  maven: /\/maven2\//,
  nuget: /\/v3\/index\.json|\/packages\//,
  pip: /\/pypi\/|\/simple\//,
  rubygems: /\/gems\/|\/api\/v1\/dependencies/,
};

// Fast format detection.
class FormatDetector {
  constructor() {
    this.stats = {
      detections: 0,
      path_based: 0,
      unknown: 0,
      user_agent_based: 0,
    };
  }

  // Detect format from request.
  detect(req) {
    this.stats.detections++;

    const path = req.url || '';
    const userAgent = req.headers['user-agent'] || '';

    // Fast path: User-Agent based detection.
    if (userAgent) {
      const format = this._detectFromUserAgent(userAgent);
      if (format) {
        this.stats.user_agent_based++;
        return format;
      }
    }

    // Path-based detection.
    const pathFormat = this._detectFromPath(path);
    if (pathFormat) {
      this.stats.path_based++;
      return pathFormat;
    }

    // Default to npm for unknown.
    this.stats.unknown++;
    return FORMATS.npm;
  }

  // Detect from User-Agent header.
  _detectFromUserAgent(userAgent) {
    // Fast check for common patterns.
    for (const [format, pattern] of Object.entries(USER_AGENT_PATTERNS)) {
      if (pattern.test(userAgent)) {
        return format;
      }
    }
    return null;
  }

  // Detect from request path.
  _detectFromPath(path) {
    for (const [format, pattern] of Object.entries(PATH_PATTERNS)) {
      if (pattern.test(path)) {
        return format;
      }
    }
    return null;
  }

  // Get detection statistics.
  getStats() {
    const { detections, user_agent_based, path_based, unknown } = this.stats;
    return {
      by_method: {
        path: path_based,
        unknown,
        user_agent: user_agent_based,
      },
      total: detections,
      ua_accuracy: detections > 0
        ? ((user_agent_based / detections) * 100).toFixed(2)
        : '0.00',
    };
  }

  // Clear statistics.
  clearStats() {
    this.stats.detections = 0;
    this.stats.user_agent_based = 0;
    this.stats.path_based = 0;
    this.stats.unknown = 0;
  }
}

// Global format detector instance.
const globalFormatDetector = new FormatDetector();

module.exports = {
  FORMATS,
  FormatDetector,
  formatDetector: globalFormatDetector,
};

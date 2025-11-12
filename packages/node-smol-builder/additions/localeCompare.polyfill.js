// Save reference to original implementation.
const originalLocaleCompare = String.prototype.localeCompare

// Wrapper that coerces locales to small-icu-compatible locale.
function polyfillLocaleCompare(that, _locales, options) {
  // Coerce locales to 'en-US' (small-icu always supports English).
  // This prevents errors when code passes unsupported locales like 'zh-CN', 'ar-SA', etc.
  const safeLocales = 'en-US'

  try {
    // Call native implementation with coerced locale.
    return originalLocaleCompare.call(this, that, safeLocales, options)
  } catch (_e) {
    // If native still throws (shouldn't happen with 'en-US'), use basic comparison.
    if (that < this) {
      return -1
    }
    if (that > this) {
      return 1
    }
    return 0
  }
}

// Replace String.prototype.localeCompare with wrapped version.
// Direct assignment instead of Object.defineProperty to avoid bootstrap ordering issues.
String.prototype.localeCompare = polyfillLocaleCompare

/**
 * Socket CLI: Polyfill localeCompare
 *
 * Locale coercion wrapper for String.prototype.localeCompare() in small-icu builds.
 *
 * WHY THIS EXISTS:
 * - Node.js built with --with-intl=small-icu has English-only ICU data
 * - localeCompare() may throw errors for non-English locales (e.g., 'zh-CN', 'ar-SA')
 * - This polyfill coerces unsupported locales to 'en-US' to prevent errors
 *
 * WHEN IT ACTIVATES:
 * - Always wraps native localeCompare()
 * - Coerces non-English locales to 'en-US' (small-icu compatible)
 * - Preserves options (numeric, sensitivity, etc.)
 *
 * LIMITATIONS:
 * - All comparisons use English collation rules
 * - Non-ASCII characters may not sort correctly for their locale
 * - Sufficient for Socket CLI's use cases (version sorting, package names)
 */

// biome-ignore lint/suspicious/noRedundantUseStrict: Required for Node.js internal module
'use strict'

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
  } catch {
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

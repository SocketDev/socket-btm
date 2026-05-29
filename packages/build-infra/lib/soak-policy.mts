/**
 * Fleet-wide soak policy for external pins.
 *
 * Mirrors pnpm-workspace.yaml `minimumReleaseAge: 10080` (7 days, in minutes).
 * One constant, one annotation shape, every pin surface. Bumping the floor
 * here propagates to every surface that consumes this module:
 *
 *   - .gitmodules submodule pins
 *   - .github/workflows/*.yml SHA-pinned `uses:` lines
 *   - Docker `FROM @sha256:` digests
 *   - external-tools.json `version` fields
 *   - choco install --version=<X> Windows toolchain pins
 *
 * Annotation shape (matches pnpm-workspace.yaml):
 *
 *   # published: YYYY-MM-DD | removable: YYYY-MM-DD
 *
 * The `published` date is the pin's source-of-truth publish date (registry
 * publish time, GitHub commit author date, container manifest `created`).
 * The `removable` date is `published + SOAK_DAYS`; once it passes, the
 * annotation can be dropped because the soak is satisfied.
 */

const MINUTES_PER_DAY = 60 * 24

/**
 * Soak floor in days. Mirrors pnpm-workspace.yaml `minimumReleaseAge: 10080`
 * (10080 minutes = 7 days). Never reduce without `Allow trust-downgrade bypass`.
 */
export const SOAK_DAYS = 7

/**
 * Soak floor in milliseconds. Derived; do not duplicate.
 */
export const SOAK_MS = SOAK_DAYS * MINUTES_PER_DAY * 60 * 1000

/**
 * Annotation regex. Captures `published` and `removable` ISO-8601 dates.
 * Tolerates surrounding whitespace + leading comment markers (`#` or `//`).
 */
export const ANNOTATION_RE =
  /(?:#|\/\/)\s*published:\s*(\d{4}-\d{2}-\d{2})\s*\|\s*removable:\s*(\d{4}-\d{2}-\d{2})/

/**
 * Parse an ISO-8601 date (YYYY-MM-DD) to a Date at midnight UTC. Returns
 * null for malformed input — the caller decides whether that's a hard fail.
 */
export function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Compute the soak deadline (`removable`) from a `published` date.
 */
export function computeRemovable(published) {
  const date = parseIsoDate(published)
  if (date === null) {
    return null
  }
  return new Date(date.getTime() + SOAK_MS)
}

/**
 * Format a Date as YYYY-MM-DD (UTC). Inverse of `parseIsoDate`.
 */
export function formatIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

/**
 * Check whether a pin's `published` date satisfies the soak floor.
 *
 * @param {object} options
 * @param {string} options.published - ISO-8601 publish date (YYYY-MM-DD).
 * @param {Date} [options.now] - Override for current time (testing only).
 * @returns {{soaked: boolean, daysOld: number, removable: string | null, removableAt: Date | null}}
 *   - `soaked`: true once `now >= published + SOAK_DAYS`.
 *   - `daysOld`: integer days since publish (floor).
 *   - `removable`: ISO date when the soak completes (or null on parse fail).
 *   - `removableAt`: same as `removable` but as a Date object.
 */
export function checkSoak({ published, now = new Date() }) {
  const publishedDate = parseIsoDate(published)
  if (publishedDate === null) {
    return { soaked: false, daysOld: 0, removable: null, removableAt: null }
  }
  const removableAt = new Date(publishedDate.getTime() + SOAK_MS)
  const daysOld = Math.floor(
    (now.getTime() - publishedDate.getTime()) / (MINUTES_PER_DAY * 60 * 1000),
  )
  return {
    soaked: now.getTime() >= removableAt.getTime(),
    daysOld,
    removable: formatIsoDate(removableAt),
    removableAt,
  }
}

/**
 * Parse a soak annotation comment. Accepts the canonical shape:
 *
 *   # published: YYYY-MM-DD | removable: YYYY-MM-DD
 *
 * Returns null when no match is found. The `removable` date is recomputed
 * from `published` so a corrupted annotation can't lengthen the soak
 * window — the source of truth is `published`.
 */
export function parseAnnotation(line) {
  if (typeof line !== 'string') {
    return null
  }
  const match = line.match(ANNOTATION_RE)
  if (match === null) {
    return null
  }
  const published = match[1]
  const removableComputed = formatIsoDate(computeRemovable(published))
  return { published, removable: removableComputed }
}

/**
 * Format a canonical soak annotation comment. The leading marker (`#` or
 * `//`) is the caller's choice — different surfaces use different shapes.
 */
export function formatAnnotation(published, { marker = '#' } = {}) {
  const removable = formatIsoDate(computeRemovable(published))
  if (removable === null) {
    return null
  }
  return `${marker} published: ${published} | removable: ${removable}`
}

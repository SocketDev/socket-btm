/**
 * Fleet-wide soak policy for external pins.
 *
 * Mirrors pnpm-workspace.yaml `minimumReleaseAge: 10080` (7 days). One
 * constant, one annotation shape, every pin surface (.gitmodules, workflow
 * `uses:`, Docker `FROM @sha256:`, external-tools.json, pnpm-workspace.yaml).
 *
 * Annotation shape:
 *
 *   # published: YYYY-MM-DD | removable: YYYY-MM-DD
 *
 * `published` is the source of truth (registry publish time, GH commit
 * author date, container manifest `created`). `removable` is derived
 * (`published + SOAK_DAYS`) and re-validated on parse so a corrupted
 * annotation can't lengthen the soak.
 */

const ANNOTATION_RE =
  /(?:#|\/\/)\s*published:\s*(\d{4}-\d{2}-\d{2})\s*\|\s*removable:\s*\d{4}-\d{2}-\d{2}/

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

/**
 * Soak floor in days. Mirrors pnpm-workspace.yaml `minimumReleaseAge: 10080`
 * (10080 minutes = 7 days). Never reduce without `Allow trust-downgrade bypass`.
 */
export const SOAK_DAYS = 7

const SOAK_MS = SOAK_DAYS * MS_PER_DAY

/**
 * Check whether a pin's `published` date satisfies the soak floor.
 *
 * @returns `{soaked, daysOld, removable}` — `removable` is undefined on
 * malformed input.
 */
export function checkSoak(published, now = new Date()) {
  const publishedDate = parseIsoDate(published)
  if (publishedDate === undefined) {
    return { soaked: false, daysOld: 0, removable: undefined }
  }
  const removableAtMs = publishedDate.getTime() + SOAK_MS
  return {
    soaked: now.getTime() >= removableAtMs,
    daysOld: Math.floor((now.getTime() - publishedDate.getTime()) / MS_PER_DAY),
    removable: formatIsoDate(new Date(removableAtMs)),
  }
}

export function computeRemovableIso(published) {
  const date = parseIsoDate(published)
  return date === undefined
    ? undefined
    : formatIsoDate(new Date(date.getTime() + SOAK_MS))
}

/**
 * Format a canonical annotation comment. Marker defaults to `#` (most
 * surfaces); `//` for TS/JS source comments.
 */
export function formatAnnotation(published, marker = '#') {
  const removable = computeRemovableIso(published)
  return removable === undefined
    ? undefined
    : `${marker} published: ${published} | removable: ${removable}`
}

export function formatIsoDate(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * Parse a soak annotation comment. Returns undefined when no match. The
 * `removable` date is recomputed from `published` (the regex's literal
 * `removable:` is matched only as a shape guard) so a corrupted annotation
 * can't lengthen the soak window.
 */
export function parseAnnotation(line) {
  if (typeof line !== 'string') {
    return undefined
  }
  const match = line.match(ANNOTATION_RE)
  if (match === null) {
    return undefined
  }
  return { published: match[1], removable: computeRemovableIso(match[1]) }
}

export function parseIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
    return undefined
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

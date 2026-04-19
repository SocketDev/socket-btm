/**
 * @fileoverview Small helpers for extracting displayable error text.
 *
 * Most catch-block callers in this package do
 * `` `... ${error.message}` ``, which silently prints "undefined" if the
 * thrown value isn't an Error instance (e.g. `throw "string"`, `throw 42`,
 * or spawn promises that reject with a non-Error payload). `errorMessage`
 * returns a sensible string in every case and lets those call sites stay
 * one-liners.
 */

/**
 * Extract a human-readable message from an unknown caught value.
 *
 * - Error instances: returns `error.message`.
 * - Anything else: returns `String(value)` (covers strings, numbers,
 *   `undefined`, and plain objects).
 *
 * @param {unknown} error - Value caught by a `catch` block.
 * @returns {string} A displayable message — never `undefined`.
 */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @fileoverview Re-export of the canonical `errorMessage` helper.
 *
 * `@socketsecurity/lib/errors` walks the `cause` chain, coerces primitives,
 * and returns the shared `UNKNOWN_ERROR` sentinel when nothing yields a
 * usable string — covers every case the local shim used to handle and
 * more.
 */

export { errorMessage } from '@socketsecurity/lib/errors'

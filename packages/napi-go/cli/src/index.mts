/**
 * napi-go CLI public surface.
 *
 * Downstream builder packages import from `napi-go/cli`:
 *
 *   import { buildNapiGoAddon } from 'napi-go/cli'
 *
 * This entry re-exports the pieces a builder script needs.
 */

export { buildNapiGoAddon } from './build.mts'
export { getGoTarget, resolveNodeIncludeDir } from './resolve.mts'

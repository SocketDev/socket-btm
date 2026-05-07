/**
 * Public API for lief-builder.
 * Exports functions to ensure LIEF library is available.
 */
export {
  ensureLief,
  getLiefLibPath,
  liefExists,
  liefExistsAt,
  verifyLiefAt,
} from '../scripts/build.mts'

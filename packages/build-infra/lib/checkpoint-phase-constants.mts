/**
 * Checkpoint phase names and per-package checkpoint chains — split out of
 * constants.mts (max-file-lines soft cap) since this block is self-contained.
 */

/**
 * Checkpoint names used by checkpoint-manager.
 * Use these instead of hardcoded strings to ensure consistency.
 */
// socket-lint: allow object-property-order -- grouped by pipeline phase (common → model → wasm → binary), not alphabetical
export const CHECKPOINTS = {
  // Common/universal checkpoints.
  FINALIZED: 'finalized',

  // Model/data pipeline checkpoints.
  DOWNLOADED: 'downloaded',
  CONVERTED: 'converted',
  QUANTIZED: 'quantized',
  OPTIMIZED: 'optimized',

  // WASM pipeline checkpoints. The build-pipeline orchestrator now writes a
  // SOURCE_CLONED checkpoint for packages that clone from a git remote into
  // a shared (platform-agnostic) source dir; the tarball lets CI restore the
  // cloned tree without re-hitting the remote. SOURCE_CONFIGURED remains the
  // downstream gate for packages that need a CMake/autogen step.
  SOURCE_CLONED: 'source-cloned',
  SOURCE_COPIED: 'source-copied',
  SOURCE_CONFIGURED: 'source-configured',
  WASM_COMPILED: 'wasm-compiled',
  WASM_OPTIMIZED: 'wasm-optimized',
  WASM_RELEASED: 'wasm-released',
  WASM_SYNCED: 'wasm-synced',

  // Binary/native build checkpoints.
  BINARY_COMPRESSED: 'binary-compressed',
  BINARY_RELEASED: 'binary-released',
  BINARY_STRIPPED: 'binary-stripped',
  LIEF_BUILT: 'lief-built',
  MBEDTLS_BUILT: 'mbedtls-built',
  NATIVE_BUILT: 'native-built',
  SOURCE_PATCHED: 'source-patched',
}

// Set of all valid checkpoint values for runtime validation.
const VALID_CHECKPOINT_VALUES = new Set(Object.values(CHECKPOINTS))

// Checkpoints that are NOT specific to a platform/arch/libc tuple.
// Source-stage checkpoints (clone, copy, patch, configure) apply the same
// transformations regardless of target — they carry no compiled artifacts, so
// their cache keys omit platform metadata and their restored tarballs live in
// the shared source dir instead of the per-mode checkpoint dir.
// createCheckpoint / restoreCheckpoint / shouldRun must all agree on this set
// or platform-agnostic checkpoints end up created platform-aware and rejected
// at restore time (or vice versa).
// Note: model pipeline checkpoints (DOWNLOADED, CONVERTED, QUANTIZED, OPTIMIZED)
// are content-agnostic but infra-specific — they route through per-mode
// checkpoint dirs (see restore-checkpoint action). Model builders pass explicit
// platform/arch rather than joining this set.
// oxlint-disable-next-line socket/sort-set-args -- elements reference CHECKPOINTS.* (not literals) so the rule can't verify sort order; already alphabetized by value (source-cloned, source-configured, source-copied, source-patched)
export const PLATFORM_AGNOSTIC_CHECKPOINTS = new Set<string>([
  CHECKPOINTS.SOURCE_CLONED,
  CHECKPOINTS.SOURCE_CONFIGURED,
  CHECKPOINTS.SOURCE_COPIED,
  CHECKPOINTS.SOURCE_PATCHED,
])

// The subset of PLATFORM_AGNOSTIC_CHECKPOINTS that live in the shared source
// dir (source-cloned / source-copied) rather than a per-mode dir is enforced
// by the `is_shared_source` bash helper in
// .github/actions/restore-checkpoint/action.yml. Keep the two in sync if
// either set changes.

/**
 * Checkpoint chain generators for each package type.
 * Centralized to avoid duplication across packages.
 */
export const CHECKPOINT_CHAINS = {
  /**
   * Curl build checkpoint chain.
   * Used by curl-builder for libcurl with mbedTLS.
   */
  curl: () => [CHECKPOINTS.FINALIZED, CHECKPOINTS.MBEDTLS_BUILT],

  /**
   * LIEF build checkpoint chain.
   * Used by lief-builder for its single LIEF_BUILT checkpoint (the build
   * does not emit a separate FINALIZED stage — LIEF_BUILT IS the final output).
   */
  lief: () => [CHECKPOINTS.LIEF_BUILT],

  /**
   * Model pipeline checkpoint chain (with optimization step).
   * Used by codet5-models-builder, minilm-builder.
   * Same for dev and prod.
   */
  model: () => [
    CHECKPOINTS.FINALIZED,
    CHECKPOINTS.OPTIMIZED,
    CHECKPOINTS.QUANTIZED,
    CHECKPOINTS.CONVERTED,
    CHECKPOINTS.DOWNLOADED,
  ],

  /**
   * Simple model pipeline checkpoint chain (without optimization).
   * Used by models package for basic model downloads.
   * Same for dev and prod.
   */
  modelSimple: () => [
    CHECKPOINTS.FINALIZED,
    CHECKPOINTS.QUANTIZED,
    CHECKPOINTS.CONVERTED,
    CHECKPOINTS.DOWNLOADED,
  ],

  /**
   * Node-smol binary pipeline checkpoint chain.
   * Same for dev and prod.
   */
  nodeSmol: () => [
    CHECKPOINTS.FINALIZED,
    CHECKPOINTS.BINARY_COMPRESSED,
    CHECKPOINTS.BINARY_STRIPPED,
    CHECKPOINTS.BINARY_RELEASED,
    CHECKPOINTS.SOURCE_PATCHED,
    CHECKPOINTS.SOURCE_COPIED,
  ],

  /**
   * ONNX Runtime WASM pipeline checkpoint chain.
   * Dev skips wasm-optimized for faster builds.
   */
  onnxruntime: (mode: string) => {
    if (mode === 'prod') {
      return [
        CHECKPOINTS.FINALIZED,
        CHECKPOINTS.WASM_SYNCED,
        CHECKPOINTS.WASM_OPTIMIZED,
        CHECKPOINTS.WASM_RELEASED,
        CHECKPOINTS.WASM_COMPILED,
        CHECKPOINTS.SOURCE_CLONED,
      ]
    }
    return [
      CHECKPOINTS.FINALIZED,
      CHECKPOINTS.WASM_SYNCED,
      CHECKPOINTS.WASM_RELEASED,
      CHECKPOINTS.WASM_COMPILED,
      CHECKPOINTS.SOURCE_CLONED,
    ]
  },

  /**
   * Simple single-checkpoint chain (FINALIZED only).
   * Used by binsuite packages (binpress, binflate, binject), bin-stub-builder,
   * and libpq-builder.
   */
  simple: () => [CHECKPOINTS.FINALIZED],

  /**
   * Yoga Layout WASM pipeline checkpoint chain.
   * Dev skips wasm-optimized for faster builds.
   * Includes SOURCE_CONFIGURED (yoga needs configuration step).
   */
  yoga: (mode: string) => {
    if (mode === 'prod') {
      return [
        CHECKPOINTS.FINALIZED,
        CHECKPOINTS.WASM_SYNCED,
        CHECKPOINTS.WASM_OPTIMIZED,
        CHECKPOINTS.WASM_RELEASED,
        CHECKPOINTS.WASM_COMPILED,
        CHECKPOINTS.SOURCE_CONFIGURED,
        CHECKPOINTS.SOURCE_CLONED,
      ]
    }
    return [
      CHECKPOINTS.FINALIZED,
      CHECKPOINTS.WASM_SYNCED,
      CHECKPOINTS.WASM_RELEASED,
      CHECKPOINTS.WASM_COMPILED,
      CHECKPOINTS.SOURCE_CONFIGURED,
      CHECKPOINTS.SOURCE_CLONED,
    ]
  },
}

/**
 * Validate a checkpoint chain at runtime.
 * Ensures all checkpoints in the chain are valid CHECKPOINTS constants.
 *
 * @param {string[]} chain - Checkpoint chain to validate (newest → oldest)
 * @param {string} packageName - Package name for error messages.
 *
 * @throws {Error} If chain contains invalid checkpoint names
 */
export function validateCheckpointChain(chain: string[], packageName: string) {
  if (!Array.isArray(chain)) {
    throw new Error(`${packageName}: Checkpoint chain must be an array`)
  }

  if (chain.length === 0) {
    throw new Error(`${packageName}: Checkpoint chain cannot be empty`)
  }

  const invalid = chain.filter(cp => !VALID_CHECKPOINT_VALUES.has(cp))
  if (invalid.length > 0) {
    throw new Error(
      `${packageName}: Invalid checkpoint names in chain: ${invalid.join(', ')}. ` +
        `Valid checkpoints: ${Object.keys(CHECKPOINTS).join(', ')}`,
    )
  }

  // Check for duplicates.
  const seen = new Set()
  for (let i = 0, { length } = chain; i < length; i += 1) {
    const cp = chain[i]
    if (seen.has(cp)) {
      throw new Error(`${packageName}: Duplicate checkpoint in chain: ${cp}`)
    }
    seen.add(cp)
  }
}

// Validate all checkpoint chains at module load time.
// This catches typos and invalid checkpoint names early.
// oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
for (const [name, generator] of Object.entries(CHECKPOINT_CHAINS)) {
  // Some generators require a mode argument.
  if (name === 'onnxruntime' || name === 'yoga') {
    const gen = generator as (mode: string) => string[]
    validateCheckpointChain(gen('dev'), `CHECKPOINT_CHAINS.${name}(dev)`)
    validateCheckpointChain(gen('prod'), `CHECKPOINT_CHAINS.${name}(prod)`)
  } else {
    const gen = generator as () => string[]
    validateCheckpointChain(gen(), `CHECKPOINT_CHAINS.${name}`)
  }
}

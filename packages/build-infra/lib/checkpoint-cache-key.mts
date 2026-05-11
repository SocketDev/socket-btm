import crypto from 'node:crypto'
import process from 'node:process'

/**
 * Environment variables that participate in the build-checkpoint cache
 * key. Touched by both `createCheckpoint` (write side) and `shouldRun`
 * (read side). The two MUST stay byte-identical or the cache silently
 * desyncs — writes hash one value, reads hash another, every build is
 * a miss-or-stale. Single export so both sites read from one source.
 *
 * Includes:
 *   - Compiler / linker flag envs (CFLAGS, CXXFLAGS, LDFLAGS): affect
 *     the produced binary directly.
 *   - Compiler / toolchain selectors (CC, CXX, AR, RANLIB): switching
 *     CC=clang → CC=gcc produces a different binary; the cache must
 *     reflect this.
 *   - SDK / target selectors (SDKROOT, MACOSX_DEPLOYMENT_TARGET,
 *     DEVELOPER_DIR): macOS toolchain root, deployment target.
 *   - pkg-config / linker search (PKG_CONFIG_PATH, LD_LIBRARY_PATH):
 *     change which libraries the build picks up.
 *   - Runtime knobs that change build observers (NODE_OPTIONS,
 *     UV_THREADPOOL_SIZE, V8_OPTIONS, MAKEFLAGS): can affect
 *     deterministic-build output and parallelism choices.
 *
 * Keep this list sorted by category, not alphabetically — readers can
 * scan it faster when related vars cluster.
 */
export const BUILD_CACHE_ENV_VARS = [
  // Build-output-affecting flags.
  'CFLAGS',
  'CXXFLAGS',
  'LDFLAGS',
  'MAKEFLAGS',
  // Toolchain selectors.
  'CC',
  'CXX',
  'AR',
  'RANLIB',
  // SDK / target selectors.
  'SDKROOT',
  'MACOSX_DEPLOYMENT_TARGET',
  'DEVELOPER_DIR',
  // pkg-config / linker search.
  'PKG_CONFIG_PATH',
  'LD_LIBRARY_PATH',
  // Runtime knobs.
  'NODE_OPTIONS',
  'UV_THREADPOOL_SIZE',
  'V8_OPTIONS',
] as const

/**
 * Build the underscore-joined checkpoint metadata string from the
 * standard segment list. Single source of truth for both the write
 * side (createCheckpoint) and read side (shouldRun) — the two halves
 * cannot drift the segment order or set if they both call this.
 */
export function composeCheckpointMetadata(segments: {
  platform: string | undefined
  version: string | undefined
  env: string | undefined
  buildMode: string | undefined
  lief: string | undefined
  configureFlags: string | undefined
}): string {
  return [
    segments.platform,
    segments.version,
    segments.env,
    segments.buildMode,
    segments.lief,
    segments.configureFlags,
  ]
    .filter(Boolean)
    .join('_')
}

/**
 * Compute the `env-<hash>` metadata segment of the checkpoint cache
 * key, or `undefined` if every relevant env var is unset. Single
 * source of truth — both `createCheckpoint` and `shouldRun` call this.
 */
export function computeBuildCacheEnvMetadata(): string | undefined {
  const values = BUILD_CACHE_ENV_VARS.map(
    name => process.env[name] ?? 'unset',
  )
  if (!values.some(v => v !== 'unset')) {
    return undefined
  }
  return `env-${values
    .map(v => crypto.createHash('sha256').update(v).digest('hex').slice(0, 8))
    .join('-')}`
}

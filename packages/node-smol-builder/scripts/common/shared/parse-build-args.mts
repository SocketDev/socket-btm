/**
 * CLI argument parsing + derived build configuration for build.mts, split
 * out to keep the orchestrator under the file-size soft cap. Flags are
 * documented at docs/agents.md/repo/node-smol-build-flags.md.
 */

import os from 'node:os'
import process from 'node:process'

import { BYTES, CHECKPOINTS } from 'build-infra/lib/constants'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getFeature } from '../../lib/smol-features.mts'

const logger = getDefaultLogger()

const VALID_CHECKPOINTS = [
  CHECKPOINTS.BINARY_RELEASED,
  CHECKPOINTS.BINARY_STRIPPED,
  CHECKPOINTS.BINARY_COMPRESSED,
  CHECKPOINTS.FINALIZED,
]

/**
 * Number of parallel build jobs: an explicit `BUILD_JOBS` env var override,
 * else adaptive (bounded by both CPU count and available memory, at 4GB per
 * job).
 */
export function calculateCpuCount() {
  if (process.env['BUILD_JOBS']) {
    const envJobs = Number.parseInt(process.env['BUILD_JOBS'], 10)
    if (Number.isNaN(envJobs) || envJobs < 1) {
      throw new Error(
        `Invalid BUILD_JOBS value: ${process.env['BUILD_JOBS']} (must be a positive integer)`,
      )
    }
    return envJobs
  }
  return Math.max(
    1,
    Math.min(os.cpus().length, Math.floor(os.totalmem() / (BYTES.GB * 4))),
  )
}

/**
 * Parse `--without-smol=<comma-separated feature names or raw flags>` into
 * `./configure` flags. Bare feature names are mapped to their flag via the
 * smol-features registry; `--`-prefixed tokens pass through verbatim.
 */
export function parseSmolDropArg(raw) {
  if (!raw || typeof raw !== 'string') {
    return []
  }
  const flags = []
  const tokens = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  for (let i = 0, { length } = tokens; i < length; i += 1) {
    const tok = tokens[i]!
    if (tok.startsWith('--')) {
      flags.push(tok)
    } else {
      const f = getFeature(tok)
      if (f?.configureFlagWhenDropped) {
        flags.push(f.configureFlagWhenDropped)
      } else {
        logger.warn(
          `--without-smol: "${tok}" is not a droppable feature (no configure flag); ignoring`,
        )
      }
    }
  }
  return flags
}

/**
 * Parse build.mts's CLI flags and derive the build configuration consts the
 * orchestrator needs. Sets `BUILD_WITH_LIEF`/`BUILD_WITH_DAWN` env vars as a
 * side effect (read by tests to detect LIEF/Dawn availability) — call this
 * once, at module load, before anything downstream reads them.
 */
export function parseBuildArgs() {
  const { values } = parseArgs({
    options: {
      'allow-cross': { short: 'X', type: 'boolean' },
      arch: { type: 'string' },
      'build-only': { type: 'string' },
      clean: { type: 'boolean' },
      dev: { type: 'boolean' },
      'from-checkpoint': { type: 'string' },
      libc: { type: 'string' },
      'no-compress-sea': { type: 'boolean' },
      platform: { type: 'string' },
      'platform-arch': { type: 'string' },
      prod: { type: 'boolean' },
      'stop-at': { type: 'string' },
      test: { type: 'boolean' },
      'test-full': { type: 'boolean' },
      verify: { type: 'boolean' },
      'with-dawn': { type: 'boolean' },
      'with-lief': { type: 'boolean' },
      'without-smol': { type: 'string' },
      yes: { short: 'y', type: 'boolean' },
    },
    strict: false,
  })

  const TARGET_PLATFORM = values['platform'] || process.platform
  const TARGET_ARCH = values['arch'] || process.arch
  const TARGET_LIBC = values['libc']

  // Validate libc parameter
  if (TARGET_LIBC && TARGET_LIBC !== 'musl' && TARGET_LIBC !== 'glibc') {
    throw new Error(
      `Invalid --libc value: ${TARGET_LIBC}. Valid options: musl, glibc`,
    )
  }
  if (TARGET_LIBC && TARGET_PLATFORM !== 'linux') {
    throw new Error(
      `--libc parameter is only valid for Linux platform (got platform: ${TARGET_PLATFORM})`,
    )
  }

  const CLEAN_BUILD = Boolean(values['clean'])
  const AUTO_YES = Boolean(values['yes'])
  const FROM_CHECKPOINT = values['from-checkpoint']
  const STOP_AT = values['stop-at']
  const BUILD_ONLY = values['build-only']

  // Validate checkpoint name if provided.
  if (FROM_CHECKPOINT && !VALID_CHECKPOINTS.includes(FROM_CHECKPOINT)) {
    throw new Error(
      `Invalid checkpoint: ${FROM_CHECKPOINT}. Valid options: ${VALID_CHECKPOINTS.join(', ')}`,
    )
  }
  if (STOP_AT && !VALID_CHECKPOINTS.includes(STOP_AT)) {
    throw new Error(
      `Invalid stop-at checkpoint: ${STOP_AT}. Valid options: ${VALID_CHECKPOINTS.join(', ')}`,
    )
  }
  if (BUILD_ONLY && !VALID_CHECKPOINTS.includes(BUILD_ONLY)) {
    throw new Error(
      `Invalid build-only checkpoint: ${BUILD_ONLY}. Valid options: ${VALID_CHECKPOINTS.join(', ')}`,
    )
  }
  if (BUILD_ONLY && STOP_AT) {
    throw new Error('Cannot use both --build-only and --stop-at')
  }
  if (BUILD_ONLY && FROM_CHECKPOINT) {
    throw new Error('Cannot use both --build-only and --from-checkpoint')
  }

  // Build mode: dev (fast builds) vs prod (optimized builds).
  // - CI: defaults to prod (unless --dev specified)
  // - Local: defaults to dev (unless --prod specified)
  const IS_CI = 'CI' in process.env || 'CONTINUOUS_INTEGRATION' in process.env
  const IS_PROD_BUILD = values['prod'] || (!values['dev'] && IS_CI)
  const BUILD_MODE = IS_PROD_BUILD ? 'prod' : 'dev'

  // Node.js source info - upstream/node is the source of truth.
  const NODE_REPO = 'https://github.com/nodejs/node.git'
  // NODE_SHA is derived from upstream/node at build time (see copy-source.mts).
  const NODE_SHA = undefined

  const WITH_DAWN = Boolean(values['with-dawn'])
  const WITH_LIEF = Boolean(values['with-lief'])

  // Bundle-driven feature trimming. `--without-smol=quic,tui,ffi` (comma-separated
  // feature names OR raw --without-* flags) appends configure flags that drop those
  // subsystems. Normally supplied by compile-for-bundle.mts from the detector's
  // manifest, but usable by hand for one-off lean builds.
  const EXTRA_CONFIGURE_FLAGS = parseSmolDropArg(values['without-smol'])

  // Set environment variables for tests to detect LIEF/Dawn availability.
  if (WITH_LIEF) {
    process.env['BUILD_WITH_LIEF'] = 'true'
  }
  if (WITH_DAWN) {
    process.env['BUILD_WITH_DAWN'] = 'true'
  }

  return {
    ARCH: TARGET_ARCH,
    AUTO_YES,
    BUILD_MODE,
    BUILD_ONLY,
    CLEAN_BUILD,
    EXTRA_CONFIGURE_FLAGS,
    FROM_CHECKPOINT,
    IS_CI,
    IS_PROD_BUILD,
    NODE_REPO,
    NODE_SHA,
    STOP_AT,
    TARGET_ARCH,
    TARGET_LIBC,
    TARGET_PLATFORM,
    values,
    WITH_DAWN,
    WITH_LIEF,
  }
}

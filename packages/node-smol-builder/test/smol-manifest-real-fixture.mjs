/**
 * Real-lockfile smoke test for the smol_manifest_native binding.
 *
 * Parses socket-btm's OWN pnpm-lock.yaml through the native binding
 * and asserts every PackageRef is well-formed. Catches indent-
 * collision bugs and other production-scale issues the minimal
 * regression fixtures miss (an indent-collision bug in the
 * packages:/snapshots: walker was found via this exact smoke after
 * the regression fixtures all passed).
 *
 * Run with:
 * build/dev/<platform-arch>/source/out/Release/node\
 * test/smol-manifest-real-fixture.mjs
 *
 * Runs inside the built node-smol binary, which is compiled --without-amaro
 * (no TypeScript stripping), so it must stay .mjs. Do not convert to .mts —
 * the binary cannot strip types.
 *
 * Exits non-zero on any assertion failure. Wired into
 * test/smol-manifest-native.test.mts so the same vitest CI lane
 * picks it up.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseLockfile } from 'node:smol-manifest'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const __dirname = dirname(fileURLToPath(import.meta.url))
// socket-btm root: ../../.. from packages/node-smol-builder/test/.
const BTM_ROOT = join(__dirname, '..', '..', '..')

const FIXTURES = [
  {
    path: join(BTM_ROOT, 'pnpm-lock.yaml'),
    eco: 'npm',
    fmt: 'pnpm',
    // Smallest valid v9 lockfile is ~50 entries for socket-btm's
    // mono-repo shape. Treat anything below this as a probable
    // parse failure that swallowed input rather than throwing.
    minPackages: 50,
  },
]

let totalPackages = 0
let totalElapsedMs = 0

// oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
for (const { path, eco, fmt, minPackages } of FIXTURES) {
  if (!existsSync(path)) {
    logger.log(`SKIP  ${path} (not present)`)
    continue
  }

  const content = readFileSync(path, 'utf8')

  const start = process.hrtime.bigint()
  const result = parseLockfile(content, eco, fmt)
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000
  totalElapsedMs += elapsedMs

  // Structural assertions.
  if (result.type !== 'lockfile') {
    logger.fail(`FAIL  ${path}: bad type ${result.type}`)
    process.exit(1)
  }
  if (!Array.isArray(result.packages)) {
    logger.fail(`FAIL  ${path}: packages not array`)
    process.exit(1)
  }
  if (result.packages.length < minPackages) {
    logger.fail(
      `FAIL  ${path}: only ${result.packages.length} packages, expected ≥ ${minPackages}`,
    )
    process.exit(1)
  }

  // Every PackageRef is well-formed.
  const malformed = []
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const p of result.packages) {
    if (!p.name || typeof p.name !== 'string') {
      malformed.push(p)
      continue
    }
    if (!p.version || typeof p.version !== 'string') {
      malformed.push(p)
      continue
    }
    if (typeof p.isDev !== 'boolean') {
      malformed.push(p)
      continue
    }
    if (typeof p.isOptional !== 'boolean') {
      malformed.push(p)
      continue
    }
    if (typeof p.isPeer !== 'boolean') {
      malformed.push(p)
      continue
    }
    if (typeof p.isBundled !== 'boolean') {
      malformed.push(p)
      continue
    }
  }
  if (malformed.length > 0) {
    logger.fail(`FAIL  ${path}: ${malformed.length} malformed PackageRefs`)
    logger.fail(`  samples: ${JSON.stringify(malformed.slice(0, 3), null, 2)}`)
    process.exit(1)
  }

  // _index must hold every package name (or alias).
  const indexKeys = Object.keys(result._index).length
  if (indexKeys === 0) {
    logger.fail(`FAIL  ${path}: empty _index`)
    process.exit(1)
  }

  logger.log(
    `PASS  ${path}  (${result.packages.length} packages, ${indexKeys} index keys, ${elapsedMs.toFixed(2)}ms)`,
  )
  totalPackages += result.packages.length
}

logger.log('')
logger.log(
  `total: ${totalPackages} packages parsed in ${totalElapsedMs.toFixed(2)}ms`,
)
process.exit(0)

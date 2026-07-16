/**
 * WASM build pipeline orchestrator.
 *
 * Declarative orchestrator for wasm-shipping packages. Given a manifest of
 * ordered stages, it drives the canonical sequence:
 * clone source → configure → compile → release → (optimize) → sync → finalize.
 *
 * The orchestrator owns every moving part that today lives in each package's
 * 340-line build.mts:
 *
 * - Build mode + platform-arch detection (uses centralized helpers).
 * - Loading external-tools.json + package.json `sources` metadata.
 * - Deriving a unified cache key from: node version, platform, arch, build mode,
 *   pinned tool versions, and source refs. Tool bump or source SHA bump
 *   invalidates the cache automatically — no hand-wired busting.
 * - Per-stage shouldRun() / createCheckpoint() wrapping. Stages become pure work
 *   functions; they do not implement skip-if-cached themselves.
 * - Common CLI flags: --prod / --dev / --force / --clean / --clean-stage=<name> /
 *   --from-stage=<name> / --cache-key.
 *
 * A stage is `(ctx, params) => Promise<void>`. `ctx` carries derived values
 * shared by every stage (paths, mode, logger, tool versions, source meta).
 * `params` holds stage-local overrides from the manifest.
 *
 * @module build-infra/lib/build-pipeline
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  cleanCheckpoint,
  createCheckpoint,
  shouldRun,
} from './checkpoint-manager.mts'
import { getBuildMode, validateCheckpointChain } from './constants.mts'
import { errorMessage } from './error-utils.mts'
import { validateExternalTools } from './external-tools-schema.mts'
import {
  getCurrentPlatformArch,
  parsePlatformArch,
} from './platform-mappings.mts'
import { getNodeVersion } from './version-helpers.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import type { ExternalToolsFile } from './external-tools-schema.mts'
import type {
  PipelineContext,
  PipelinePackageJson,
  PipelineSourceMeta,
  RunPipelineOptions,
} from './build-pipeline-types.mts'

export type {
  PipelineBuildPaths,
  PipelineContext,
  PipelineFlags,
  PipelinePackageJson,
  PipelineSourceMeta,
  PipelineStage,
  RunPipelineOptions,
  StageResult,
} from './build-pipeline-types.mts'

const logger = getDefaultLogger()

export function buildCacheKey({
  buildMode,
  nodeVersion,
  platformArch,
  sources,
  toolVersions,
  toolsHash,
  packageVersion,
  extraHash,
}: {
  buildMode: string
  extraHash?: string | undefined
  nodeVersion: string
  packageVersion: string
  platformArch: string
  sources: Record<string, PipelineSourceMeta>
  toolVersions: Record<string, string>
  toolsHash: string
}): string {
  const hash = crypto.createHash('sha256')
  hash.update(`node=${nodeVersion}`)
  hash.update(`platformArch=${platformArch}`)
  hash.update(`mode=${buildMode}`)
  hash.update(`tools=${toolsHash}`)
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const tool of Object.keys(toolVersions).toSorted()) {
    hash.update(`${tool}@${toolVersions[tool]}`)
  }
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const key of Object.keys(sources).toSorted()) {
    const src = sources[key] ?? {}
    hash.update(
      `src:${key}=${src.version ?? ''}:${src.ref ?? ''}:${src.url ?? ''}`,
    )
  }
  if (extraHash) {
    hash.update(`extra=${extraHash}`)
  }
  const digest = hash.digest('hex').slice(0, 12)
  return `v${nodeVersion}-${platformArch}-${buildMode}-${digest}-${packageVersion}`
}

export function hashFileContents(files: string[]): string {
  const hash = crypto.createHash('sha256')
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const file of files.toSorted()) {
    let content = Buffer.alloc(0)
    if (existsSync(file)) {
      try {
        content = readFileSync(file)
      } catch {}
    }
    hash.update(`${file}:`)
    hash.update(content)
  }
  return hash.digest('hex').slice(0, 16)
}

export async function loadExternalTools(
  packageRoot: string,
): Promise<{ rawHash: string; versions: Record<string, string> }> {
  const filePath = path.join(packageRoot, 'external-tools.json')
  const data = await readJson<ExternalToolsFile>(filePath)
  if (!data) {
    return { versions: {}, rawHash: '' }
  }
  validateExternalTools(data)
  const versions: Record<string, string> = {}
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [tool, meta] of Object.entries(data.tools ?? {})) {
    versions[tool] = meta?.version ?? ''
  }
  const rawHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 16)
  return { versions, rawHash }
}

export async function loadPackageJson(
  packageRoot: string,
): Promise<PipelinePackageJson> {
  const pkg = await readJson<PipelinePackageJson>(
    path.join(packageRoot, 'package.json'),
  )
  if (!pkg) {
    throw new Error(`Missing package.json in ${packageRoot}`)
  }
  return pkg
}

export function parseFlags(argv) {
  const args = new Set(argv)
  const getValue = flag => {
    const prefix = `${flag}=`
    for (let i = 0, { length } = argv; i < length; i += 1) {
      const arg = argv[i]
      if (arg.startsWith(prefix)) {
        return arg.slice(prefix.length)
      }
    }
    return undefined
  }
  return {
    force: args.has('--force'),
    clean: args.has('--clean'),
    printCacheKey: args.has('--cache-key'),
    cleanStage: getValue('--clean-stage'),
    fromStage: getValue('--from-stage'),
    raw: args,
  }
}

export async function readJson(filePath) {
  let raw
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      return undefined
    }
    throw new Error(`Failed to read ${filePath}: ${errorMessage(e)}`, {
      cause: e,
    })
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`Failed to parse ${filePath}: ${errorMessage(e)}`, {
      cause: e,
    })
  }
}

export function resolveCheckpointBuildDir(stage, ctx) {
  if (stage.shared && ctx.sharedPaths?.buildDir) {
    return ctx.sharedPaths.buildDir
  }
  return ctx.paths.buildDir
}

/**
 * Validate + run a pipeline. On --cache-key, prints the key and exits without
 * building. Returns the context so the caller can render a summary.
 *
 * @param {RunPipelineOptions} options
 * @param {object} [cliOverrides] - Pre-parsed flags (for programmatic use).
 *
 * @returns {Promise<PipelineContext>}
 */
export async function runPipeline(options, cliOverrides) {
  const {
    extraCacheInputs = [],
    getBuildPaths,
    getOutputFiles,
    getSharedBuildPaths,
    packageName,
    packageRoot,
    preflight,
    stages,
  } = { __proto__: null, ...options } as typeof options

  const flags = cliOverrides ?? parseFlags(process.argv.slice(2))
  const buildMode = getBuildMode(flags.raw ?? new Set())
  const platformArch = await getCurrentPlatformArch()
  const nodeVersion = getNodeVersion().replace(/^v/, '')

  const [pkgJson, { versions: toolVersions, rawHash: toolsHash }] =
    await Promise.all([
      loadPackageJson(packageRoot),
      loadExternalTools(packageRoot),
    ])

  const sources = pkgJson.sources ?? {}
  const packageVersion = pkgJson.version ?? '0.0.0'

  const extraHash =
    extraCacheInputs.length > 0 ? hashFileContents(extraCacheInputs) : ''
  const cacheKey = buildCacheKey({
    buildMode,
    extraHash,
    nodeVersion,
    packageVersion,
    platformArch,
    sources,
    toolsHash,
    toolVersions,
  })

  if (flags.printCacheKey) {
    process.stdout.write(`${cacheKey}\n`) // socket-hook: allow logger -- shell capture of cache key
    return
  }

  const paths = getBuildPaths(buildMode, platformArch)
  const sharedPaths = getSharedBuildPaths ? getSharedBuildPaths() : undefined
  const outputFiles = getOutputFiles ? getOutputFiles(paths) : []

  // Validate chain for typos / unknown names.
  validateCheckpointChain(
    stages.map(s => s.name),
    packageName,
  )

  const ctx = {
    buildMode,
    cacheKey,
    forceRebuild: flags.force,
    logger,
    nodeVersion,
    packageName,
    packageRoot,
    paths,
    platformArch,
    sharedPaths,
    sources,
    toolVersions,
  }

  const totalStart = Date.now()
  logger.step(`🔨 Building ${packageName}`)
  logger.info(`Mode: ${buildMode}`)
  logger.info(`Platform: ${platformArch}`)
  logger.info(`Cache key: ${cacheKey}`)
  logger.info('')

  // Handle --clean / --clean-stage / missing-output clean-up.
  if (flags.clean) {
    logger.substep('Clean build requested — removing all checkpoints')
    await cleanCheckpoint(paths.buildDir, '')
    if (sharedPaths?.buildDir) {
      await cleanCheckpoint(sharedPaths.buildDir, '')
    }
  } else if (flags.cleanStage) {
    logger.substep(`Clean requested for stage: ${flags.cleanStage}`)
    // Invalidates this stage + anything depending on it.
    const idx = stages.findIndex(s => s.name === flags.cleanStage)
    if (idx === -1) {
      throw new Error(
        `Unknown --clean-stage=${flags.cleanStage}. Valid: ${stages.map(s => s.name).join(', ')}`,
      )
    }
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const stage of stages.slice(idx)) {
      const buildDir = resolveCheckpointBuildDir(stage, ctx)
      const markerDir = path.join(buildDir, 'checkpoints')
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const ext of ['.json', '.tar.gz', '.tar.gz.lock']) {
        const file = path.join(markerDir, `${stage.name}${ext}`)
        if (existsSync(file)) {
          await safeDelete(file)
        }
      }
    }
  } else if (outputFiles.length && outputFiles.some(p => !existsSync(p))) {
    logger.substep(
      'Output artifacts missing — invalidating all checkpoints to rebuild',
    )
    await cleanCheckpoint(paths.buildDir, '')
    if (sharedPaths?.buildDir) {
      await cleanCheckpoint(sharedPaths.buildDir, '')
    }
  }

  if (preflight) {
    logger.step('Pre-flight Checks')
    await preflight()
    logger.success('Pre-flight checks passed')
  }

  // --from-stage: pretend earlier stages succeeded (they should have cached
  // checkpoints already). We just skip running them.
  let startIdx = 0
  if (flags.fromStage) {
    startIdx = stages.findIndex(s => s.name === flags.fromStage)
    if (startIdx === -1) {
      throw new Error(
        `Unknown --from-stage=${flags.fromStage}. Valid: ${stages.map(s => s.name).join(', ')}`,
      )
    }
    logger.substep(`Starting from stage: ${flags.fromStage}`)
  }

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const stage of stages.slice(startIdx)) {
    await runStage(stage, ctx, {})
  }

  const seconds = ((Date.now() - totalStart) / 1000).toFixed(1)
  logger.step('🎉 Build Complete!')
  logger.success(`Total time: ${seconds}s`)
  logger.success(`Output: ${paths.outputFinalDir ?? paths.buildDir}`)
  if (outputFiles.length) {
    logger.info('')
    logger.info('Files:')
    for (let i = 0, { length } = outputFiles; i < length; i += 1) {
      const file = outputFiles[i]
      logger.info(`  - ${path.relative(packageRoot, file)}`)
    }
    logger.info('')
  }
  return ctx
}

/**
 * CLI entry-point helper. Wraps runPipeline with a top-level error handler.
 *
 * @param {RunPipelineOptions} options
 */
export async function runPipelineCli(options) {
  try {
    await runPipeline(options)
  } catch (e) {
    logger.error(errorMessage(e))
    process.exitCode = 1
    throw e
  }
}

export async function runStage(stage, ctx, stageParams) {
  const { buildMode, forceRebuild, logger: stageLogger } = ctx

  if (stage.skipInDev && buildMode === 'dev') {
    stageLogger.substep(`Skipping ${stage.name} (dev build)`)
    return
  }

  const buildDir = resolveCheckpointBuildDir(stage, ctx)
  const sourcePaths = [
    path.join(ctx.packageRoot, 'external-tools.json'),
    path.join(ctx.packageRoot, 'package.json'),
    ...(stage.sourcePaths ?? []),
  ].filter(p => existsSync(p))

  // Derive target {platform, arch, libc} from ctx.platformArch instead of
  // falling back to process.*. The pipeline may cross-compile (e.g. building
  // a linux-musl WASM bundle from a darwin host), and createCheckpoint /
  // shouldRun now reject host-fallback metadata because it silently mis-tags
  // cache entries. parsePlatformArch is the inverse of getAssetPlatformArch
  // that produced ctx.platformArch at pipeline startup.
  const platformMeta = stage.shared
    ? {}
    : (() => {
        const { platform, arch, libc } = parsePlatformArch(ctx.platformArch)
        return {
          arch,
          buildMode,
          libc,
          nodeVersion: ctx.nodeVersion,
          platform,
        }
      })()

  const shouldProceed = await shouldRun(
    buildDir,
    '',
    stage.name,
    forceRebuild,
    sourcePaths,
    platformMeta,
  )

  if (!shouldProceed) {
    // oxlint-disable-next-line socket/no-status-emoji -- substep is an indented line marker, not a top-level status; the leading "✓" complements the substep indent.
    stageLogger.substep(`✓ ${stage.name} up-to-date (cached)`)
    return
  }

  stageLogger.step(`Running ${stage.name}`)
  const result = (await stage.run(ctx, stageParams)) ?? {}
  const {
    artifactPath,
    binaryPath,
    binarySize,
    smokeTest = async () => {},
  } = result

  await createCheckpoint(buildDir, stage.name, smokeTest, {
    ...(artifactPath ? { artifactPath } : {}),
    ...(binaryPath ? { binaryPath } : {}),
    ...(binarySize !== undefined ? { binarySize } : {}),
    packageRoot: ctx.packageRoot,
    sourcePaths,
    ...platformMeta,
  })
}

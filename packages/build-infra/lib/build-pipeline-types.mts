/**
 * @file Public contracts for the declarative build pipeline orchestrator.
 */

import type { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

/**
 * Per-source metadata from package.json `sources`.
 */
export interface PipelineSourceMeta {
  ref?: string | undefined
  url?: string | undefined
  version?: string | undefined
  [key: string]: unknown
}

/**
 * Path bag a package's build-path resolver returns.
 */
export interface PipelineBuildPaths {
  buildDir: string
  outputFinalDir?: string | undefined
  [key: string]: unknown
}

/**
 * The package.json fields the pipeline reads.
 */
export interface PipelinePackageJson {
  sources?: Record<string, PipelineSourceMeta> | undefined
  version?: string | undefined
  [key: string]: unknown
}

/**
 * Parsed CLI flags for a pipeline run.
 */
export interface PipelineFlags {
  clean: boolean
  cleanStage: string | undefined
  force: boolean
  fromStage: string | undefined
  printCacheKey: boolean
  raw: Set<string>
}

/**
 * What a stage worker returns to configure its checkpoint.
 */
export interface StageResult {
  /**
   * Absolute path archived into the checkpoint tarball.
   */
  artifactPath?: string | undefined
  /**
   * Relative path from buildDir to a binary to codesign on macOS.
   */
  binaryPath?: string | undefined
  /**
   * Optional size metadata surfaced in checkpoint data.
   */
  binarySize?: string | number | undefined
  /**
   * Post-run validation, run before the checkpoint is committed.
   */
  smokeTest?: (() => Promise<void> | void) | undefined
}

/**
 * One declarative stage of a pipeline manifest.
 */
export interface PipelineStage {
  /**
   * Checkpoint name, which must appear in CHECKPOINTS.
   */
  name: string
  /**
   * Build worker. It must not call shouldRun or createCheckpoint. Return a
   * StageResult to configure the checkpoint.
   */
  run: (
    ctx: PipelineContext,
    params?: Record<string, unknown>,
  ) => Promise<StageResult | undefined | void>
  /**
   * Use the shared build directory for this checkpoint.
   */
  shared?: boolean | undefined
  /**
   * Skip this stage when buildMode is `dev`.
   */
  skipInDev?: boolean | undefined
  /**
   * Extra file paths whose contents contribute to this stage's cache hash.
   */
  sourcePaths?: string[] | undefined
}

/**
 * Derived values shared by every stage of a pipeline run.
 */
export interface PipelineContext {
  buildMode: string
  cacheKey: string
  forceRebuild: boolean
  logger: ReturnType<typeof getDefaultLogger>
  nodeVersion: string
  packageName: string
  packageRoot: string
  paths: PipelineBuildPaths
  platformArch: string
  sharedPaths: PipelineBuildPaths | undefined
  sources: Record<string, PipelineSourceMeta>
  toolVersions: Record<string, string>
}

/**
 * Manifest for one pipeline run.
 */
export interface RunPipelineOptions {
  /**
   * Extra files whose contents contribute to the package-wide cache key.
   */
  extraCacheInputs?: string[] | undefined
  /**
   * Package path resolver for build mode and platform architecture.
   */
  getBuildPaths: (mode: string, platformArch: string) => PipelineBuildPaths
  /**
   * Expected output artifacts. Missing files force a full rebuild.
   */
  getOutputFiles?: ((paths: PipelineBuildPaths) => string[]) | undefined
  /**
   * Optional shared-path resolver for platform-independent artifacts.
   */
  getSharedBuildPaths?: (() => PipelineBuildPaths) | undefined
  /**
   * Short package name used in logs.
   */
  packageName: string
  /**
   * Absolute package directory.
   */
  packageRoot: string
  /**
   * Optional pre-build check that throws to abort the build.
   */
  preflight?: (() => Promise<void>) | undefined
  /**
   * Stages in execution order.
   */
  stages: PipelineStage[]
}

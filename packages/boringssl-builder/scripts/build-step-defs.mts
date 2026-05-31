/**
 * @file boringssl-builder canonical build definition.
 *
 * Single source of truth for what `pnpm run build` does. Consumed by:
 *
 *   - build.mts        — native macOS/Windows + Linux-native build path.
 *                        Iterates BUILD_STEPS and spawns each via
 *                        @socketsecurity/lib's spawn().
 *   - emit-docker-build.mts — generates docker/build.sh (pure bash,
 *                        runs inside manylinux2014 with NO Node).
 *
 * Updating a configure flag, compile target, or artifact rename touches
 * exactly this file. The vitest in test/build-defs-drift.test.mts asserts
 * docker/build.sh is in sync with what an emit run would produce.
 *
 * Per fleet rule "1 path, 1 reference" — never hand-edit docker/build.sh.
 * Run `pnpm --filter boringssl-builder run emit-docker-build` after
 * changing this file.
 */

import path from 'node:path'

import { PREFIX } from './paths.mts'

/**
 * A single build step. `cmd` is the executable, `args` are positional
 * arguments. `cwd` is relative to the package root (e.g. "build/cmake")
 * or "$WORKSPACE" for an env-rooted path the bash emit knows about.
 *
 * Args may reference `$UPSTREAM_DIR`, `$CMAKE_BUILD_DIR`, `$OUT_LIB_DIR`,
 * `$OUT_INCLUDE_DIR`, `$PREFIX` — the emit step renders these as bash
 * env-var references, build.mts substitutes them with resolved paths.
 */
export interface BuildStep {
  readonly label: string
  readonly cmd: string
  readonly args: readonly string[]
}

/**
 * An artifact rename. `from` + `to` are file paths under
 * `$CMAKE_BUILD_DIR` and `$OUT_LIB_DIR` respectively.
 */
export interface PublishArtifact {
  readonly from: string
  readonly to: string
}

/**
 * Yum packages historically passed via EXTRA_PACKAGES to a per-builder
 * setup script. The shared btm-builder-glibc prebake now installs golang,
 * so this list is empty in practice — kept as a non-empty array for the
 * emit drift-check test surface.
 */
export const EXTRA_YUM_PACKAGES: readonly string[] = [
  // BoringSSL's symbol-prefix tooling under util/ is Go.
  // (Already in the shared prebake; listed for documentation.)
  'golang',
]

/**
 * Build steps run in declared order. Each step's args reference
 * placeholder env vars resolved by both consumers:
 *   - build.mts: substitutes via path.join() of getPaths() outputs
 *   - emit-docker-build.mts: emits literal "$VAR" for bash
 */
export const BUILD_STEPS: readonly BuildStep[] = [
  {
    label: 'cmake configure',
    cmd: 'cmake',
    args: [
      '-S',
      '$UPSTREAM_DIR',
      '-B',
      '$CMAKE_BUILD_DIR',
      '-DCMAKE_BUILD_TYPE=Release',
      `-DBORINGSSL_PREFIX=${PREFIX}`,
      '-DBUILD_SHARED_LIBS=OFF',
      '-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
      '-DBUILD_TESTING=OFF',
      // ccache launcher — paired with `--mount=type=cache,target=/root/
      // .ccache` in Dockerfile.glibc + the equivalent BuildKit cache
      // mount in CI. Re-runs after BoringSSL submodule updates skip
      // unchanged TUs (~5-10x speedup on incremental builds; first
      // run pays the full compile cost).
      '-DCMAKE_C_COMPILER_LAUNCHER=ccache',
      '-DCMAKE_CXX_COMPILER_LAUNCHER=ccache',
    ],
  },
  {
    label: 'cmake build crypto + ssl',
    cmd: 'cmake',
    args: [
      '--build',
      '$CMAKE_BUILD_DIR',
      '--config',
      'Release',
      '--parallel',
      '--target',
      'crypto',
      '--target',
      'ssl',
    ],
  },
]

/**
 * Artifact renames + include-tree copy. The bash emit lays these out as
 * `cp + mv` (Unix-only — the Docker path is Linux-only by design).
 * The .mts native build handles cross-platform via Unix vs MSVC lib
 * naming inside build.mts:publishArtifacts.
 *
 * Path placeholders identical to BUILD_STEPS — see above.
 */
export const PUBLISH_ARTIFACTS: readonly PublishArtifact[] = [
  {
    from: '$CMAKE_BUILD_DIR/libcrypto.a',
    to: `$OUT_LIB_DIR/lib${PREFIX}_crypto.a`,
  },
  {
    from: '$CMAKE_BUILD_DIR/libssl.a',
    to: `$OUT_LIB_DIR/lib${PREFIX}_ssl.a`,
  },
]

/**
 * Header tree copy. Source path is relative to $UPSTREAM_DIR, dest is
 * $OUT_INCLUDE_DIR (which becomes out/Final/include/).
 */
export const PUBLISH_HEADERS = {
  fromSubdir: 'include',
  toSubdir: '.',
}

/**
 * Resolved path placeholders → real paths. Used by build.mts to
 * substitute placeholders in BUILD_STEPS.args / PUBLISH_ARTIFACTS.
 */
export function resolvePlaceholders(values: {
  upstreamDir: string
  cmakeBuildDir: string
  outLibDir: string
  outIncludeDir: string
}): Record<string, string> {
  return {
    $UPSTREAM_DIR: values.upstreamDir,
    $CMAKE_BUILD_DIR: values.cmakeBuildDir,
    $OUT_LIB_DIR: values.outLibDir,
    $OUT_INCLUDE_DIR: values.outIncludeDir,
  }
}

/**
 * Substitute placeholders in a string using the map from
 * resolvePlaceholders().
 */
export function substitute(
  s: string,
  placeholders: Record<string, string>,
): string {
  let result = s
  for (const [k, v] of Object.entries(placeholders)) {
    result = result.split(k).join(v)
  }
  return result
}

/**
 * Substitute placeholders across a build step's args. Returns a new
 * step with resolved args; cmd and label are unchanged.
 */
export function substituteStep(
  step: BuildStep,
  placeholders: Record<string, string>,
): BuildStep {
  return {
    label: step.label,
    cmd: step.cmd,
    args: step.args.map(a => substitute(a, placeholders)),
  }
}

/**
 * Substitute placeholders in an artifact entry.
 */
export function substituteArtifact(
  art: PublishArtifact,
  placeholders: Record<string, string>,
): PublishArtifact {
  return {
    from: substitute(art.from, placeholders),
    to: substitute(art.to, placeholders),
  }
}

/**
 * Path-join helper that respects the bash emit (it stays as literal
 * "$VAR/sub/path") AND the native build (resolves to a host path).
 */
export function joinUpstream(...parts: string[]): string {
  return path.posix.join('$UPSTREAM_DIR', ...parts)
}

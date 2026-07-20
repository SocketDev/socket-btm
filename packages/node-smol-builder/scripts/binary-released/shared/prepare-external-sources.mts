/**
 * Prepare external sources for Node.js build.
 * Copies binject-core sources from monorepo packages to additions/ directory.
 * Syncs vendored npm packages (fast-webstreams) from npm registry.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { isDirSync } from '@socketsecurity/lib-stable/fs/inspect'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { ADDITIONS_SOURCE_PATCHED_DIR } from './paths.mts'
import { generateVendoredGypi } from './prepare-gypi.mts'
import { copySmolAiArtifacts } from './prepare-smol-ai.mts'
import { EXTERNAL_SOURCES } from './prepare-vendored-sources.mts'
import { errorMessage } from 'build-infra/lib/error-utils'
import { applyPatch } from 'build-infra/lib/patch-validator'
import {
  BIN_INFRA_DIR,
  BINJECT_DIR,
  BORINGSSL_BUILDER_DIR,
  BUILD_INFRA_DIR,
  GLIBC_SHIMS_INFRA_DIR,
  KEYSTORE_INFRA_DIR,
  LANGUAGE_MODEL_INFRA_DIR,
  LSQUIC_INFRA_DIR,
  NODE_SMOL_AI_PACKAGE_DIR,
  PACKAGE_ROOT,
  TEMPORAL_INFRA_DIR,
  TUI_INFRA_DIR,
} from '../../paths.mts'

// dawn-builder ships the prebuilt libwebgpu_dawn.a + headers (built
// by packages/dawn-builder/scripts/repo/build.mts) that node:smol-webgpu
// links against. We DON'T copy Dawn's source tree into the patched
// node source — instead we link the prebuilt static lib at the
// node.gyp level (wired in D5+).
//
// Dawn participates in the SOURCE_PATCHED cache key via the
// submodule pin: every Dawn bump rewrites the `# dawn-chromium/<N>`
// comment in .gitmodules, so hashing .gitmodules (and the lockstep
// JSON, which also tracks pinned_sha) captures Dawn invalidation
// without walking Dawn's 180 MB source tree on every cache check.
//
// dawn-builder paths (PACKAGE_ROOT, UPSTREAM_DAWN_DIR, etc.) are
// imported from `dawn-builder/scripts/paths` at the call sites that
// need them — no re-derivation here per "1 path, 1 reference".

/**
 * Files outside the regular MONOREPO_PACKAGE_SOURCES tree that still
 * need to participate in the SOURCE_PATCHED cache key. These are
 * "pin files" — single files whose content reflects the version of
 * an external dependency that the build will link against (without
 * copying that dependency's source into the patched tree).
 *
 * Currently:
 *
 * - .gitmodules — every submodule SHA bump rewrites at least the version comment
 *   line, so hashing this file catches Dawn, md4c, tree-sitter, libqrencode,
 *   etc. bumps in one shot.
 * - .config/lockstep.json — tracks pinned_sha for every upstream; hashing this is
 *   a redundant safety net.
 */
export const EXTERNAL_PIN_FILES = [
  path.join(PACKAGE_ROOT, '..', '..', '.gitmodules'),
  path.join(PACKAGE_ROOT, '..', '..', '.config', 'lockstep.json'),
  path.join(LANGUAGE_MODEL_INFRA_DIR, 'CMakeLists.txt'),
]

const logger = getDefaultLogger()

/**
 * Monorepo-package source mappings.
 *
 * INVARIANT: `from` is the cache-key authority. apply-patches.mts
 * imports this list and feeds each `from` directory to computeSourceHash
 * for the SOURCE_PATCHED cache key. `relativeTo` is purely a copy-routing
 * detail — it tells copyBuildAdditions where to land the tree under
 * modeSourceDir, and has no role in cache invalidation. Editing the
 * upstream package contents invalidates SOURCE_PATCHED automatically;
 * changing `relativeTo` does not (and shouldn't — it's a path rewrite,
 * not a content change).
 *
 * Flow: from (in this manifest) → modeSourceDir/<relativeTo> (direct copy
 * by copyBuildAdditions, no intermediate stop in additions/).
 *
 * Adding a new package here is the only edit needed to wire it into both
 * the cache and the source tree.
 *
 * Hand-maintained sources under additions/source-patched/src/
 * socketsecurity/ (sea-smol, vfs, ffi, http, etc.) are NOT in this list
 * — they live only in additions/ as authoritative sources and are picked
 * up by copyBuildAdditions' directory walk over ADDITIONS_SOURCE_PATCHED_DIR.
 */
export const MONOREPO_PACKAGE_SOURCES = [
  {
    from: path.join(LANGUAGE_MODEL_INFRA_DIR, 'src'),
    relativeTo: path.join('src', 'socketsecurity', 'language-model'),
  },
  {
    from: path.join(NODE_SMOL_AI_PACKAGE_DIR, 'lib'),
    relativeTo: path.join('lib', 'internal', 'socketsecurity', 'ai'),
  },
  {
    from: path.join(BINJECT_DIR, 'src', 'socketsecurity', 'binject'),
    relativeTo: path.join('src', 'socketsecurity', 'binject'),
  },
  {
    from: path.join(BIN_INFRA_DIR, 'src', 'socketsecurity', 'bin-infra'),
    relativeTo: path.join('src', 'socketsecurity', 'bin-infra'),
  },
  {
    from: path.join(BUILD_INFRA_DIR, 'src', 'socketsecurity', 'build-infra'),
    relativeTo: path.join('src', 'socketsecurity', 'build-infra'),
  },
  // keystore-infra: the shared OS-keychain core (extern "C" get/put/delete,
  // per-OS backends — SecItem/.mm on macOS, libsecret on Linux, Cred* on
  // Windows). The node:smol-keychain binding (keychain_binding.cc) and its
  // node.gyp wiring (patch 004, gated on node_use_smol_keychain) compile the
  // backend for the host OS; the same core also backs the proteus daemon and
  // package-level Node bindings.
  {
    from: path.join(
      KEYSTORE_INFRA_DIR,
      'src',
      'socketsecurity',
      'keystore-infra',
    ),
    relativeTo: path.join('src', 'socketsecurity', 'keystore-infra'),
  },
  {
    from: path.join(TEMPORAL_INFRA_DIR, 'src', 'socketsecurity', 'temporal'),
    relativeTo: path.join('src', 'socketsecurity', 'temporal'),
  },
  // temporal_rs compat shim: drop-in replacement for the diplomat
  // bindings that V8's js-temporal-objects.cc #includes. Lands these
  // headers at <src_root>/include/temporal_rs/ so V8 compiles against
  // the C++ port instead of the rustc/cargo-built temporal_capi
  // static lib. The node.gyp source-list patch wires the include path
  // into v8.gyp.
  {
    from: path.join(TEMPORAL_INFRA_DIR, 'include', 'temporal_rs'),
    relativeTo: path.join('include', 'temporal_rs'),
  },
  // tui-infra: ANSI emit primitives + (Tier 2+) cell buffer / render
  // loop port from socket-stuie's OpenTUI fork. The node:smol-tui
  // binding glue lives in src/socketsecurity/tui/ and includes the
  // public header from include/tui/ansi.hpp.
  {
    from: path.join(TUI_INFRA_DIR, 'src', 'socketsecurity', 'tui'),
    relativeTo: path.join('src', 'socketsecurity', 'tui'),
  },
  {
    from: path.join(TUI_INFRA_DIR, 'include', 'tui'),
    relativeTo: path.join('include', 'tui'),
  },
]

/**
 * Vendor-source patch bundles — applied to the copied vendor tree under
 * additions/source-patched/deps/<name>/ after EXTERNAL_SOURCES copies
 * land. Each bundle declares a patches dir + the deps/<name> target the
 * patches expect as their cwd (since patch paths are relative to the
 * vendor's own root, not to additions/source-patched/).
 */
export const VENDOR_PATCH_BUNDLES = [
  {
    name: 'lsquic',
    patchesDir: path.join(LSQUIC_INFRA_DIR, 'patches', 'lsquic'),
    targetDir: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'lsquic'),
  },
]

/**
 * Apply vendor-source patches (e.g. bun's 3 lsquic patches) against
 * the freshly-copied vendor tree under additions/source-patched/deps/.
 *
 * Vendor patches are owned by the *-infra packages (patches/<vendor>/),
 * not the node-smol-builder patches/ tree, because they patch upstream
 * vendor source — not Node source. They live next to the submodule they
 * patch and travel together via lockstep.
 */
export async function applyVendorPatches() {
  logger.step('Applying Vendor Patches')

  for (let i = 0, { length } = VENDOR_PATCH_BUNDLES; i < length; i += 1) {
    const bundle = VENDOR_PATCH_BUNDLES[i]
    if (!existsSync(bundle.patchesDir)) {
      logger.substep(`No patches dir for ${bundle.name}, skipping`)
      continue
    }
    if (!existsSync(bundle.targetDir)) {
      throw new Error(
        `Vendor target directory missing for ${bundle.name}: ${bundle.targetDir}. ` +
          'EXTERNAL_SOURCES copy must run before applyVendorPatches.',
      )
    }
    const entries = (await fs.readdir(bundle.patchesDir))
      .filter(name => name.endsWith('.patch'))
      .toSorted()
    if (!entries.length) {
      logger.substep(`No .patch files in ${bundle.patchesDir}, skipping`)
      continue
    }
    logger.substep(`Applying ${entries.length} patch(es) for ${bundle.name}`)
    for (let j = 0, jLen = entries.length; j < jLen; j += 1) {
      const patchPath = path.join(bundle.patchesDir, entries[j])
      try {
        await applyPatch(patchPath, bundle.targetDir)
      } catch (e) {
        throw new Error(
          `Failed to apply vendor patch ${entries[j]} for ${bundle.name}: ${errorMessage(e)}`,
          { cause: e },
        )
      }
    }
    logger.success(`All ${bundle.name} patches applied`)
  }
}

/**
 * Stage the prebuilt BoringSSL static libs + headers into the patched
 * source tree so node.gyp can resolve `deps/boringssl/boringssl.gyp:boringssl`
 * at configure time. boringssl-builder's `out/Final/{lib,include}` matches
 * the sysroot shape the gyp wrapper expects.
 *
 * Local-build → already-downloaded → prebuilt-stub fall-through is
 * handled by `ensureBoringssl` in boringssl-builder's public API; we
 * invoke that lazily via dynamic import so this file stays loadable even
 * if the boringssl-builder workspace package isn't installed yet (e.g.
 * during early sync-scaffolding bootstrap).
 */
/**
 * Stage the glibc-shims-infra workspace package into the patched source tree so
 * patch 004's `'includes': ['deps/glibc-shims-infra/glibc-shims-infra.gypi']`
 * resolves at gyp configure time. The gypi declares sources + ldflags + the
 * libdl link — node-smol's binary inherits the wrap flags and the shim .cc
 * files compile into the binary.
 */
export async function copyGlibcShimsInfra(): Promise<void> {
  logger.step('Staging glibc-shims-infra → deps/glibc-shims-infra/')
  const { safeMkdir } = await import('@socketsecurity/lib-stable/fs/safe')
  const depsDir = path.join(
    ADDITIONS_SOURCE_PATCHED_DIR,
    'deps',
    'glibc-shims-infra',
  )
  await safeMkdir(depsDir)
  // Stage the gypi at the deps/ root so patch 004's
  // 'deps/glibc-shims-infra/glibc-shims-infra.gypi' include resolves.
  await fs.cp(
    path.join(GLIBC_SHIMS_INFRA_DIR, 'gyp', 'glibc-shims-infra.gypi'),
    path.join(depsDir, 'glibc-shims-infra.gypi'),
    { force: true },
  )
  // Stage the C++ source tree at deps/glibc-shims-infra/src/. The gypi's
  // relative paths (src/socketsecurity/glibc-2-17-compat/...) line up with
  // this layout because the gypi resolves source paths relative to its own
  // location — same gypi rule that yoga/lsquic/boringssl follow.
  await fs.cp(
    path.join(GLIBC_SHIMS_INFRA_DIR, 'src'),
    path.join(depsDir, 'src'),
    { recursive: true, force: true },
  )
  logger.substep(`staged glibc-shims-infra → ${depsDir}`)
}

export async function copyBoringsslArtifacts(): Promise<void> {
  logger.step('Staging BoringSSL prebuilt → deps/boringssl/')
  const { ensureBoringssl, getCurrentBoringsslPlatformArch } = await import(
    path.join(BORINGSSL_BUILDER_DIR, 'lib', 'ensure-boringssl.mts')
  )
  const { safeMkdir } = await import('@socketsecurity/lib-stable/fs/safe')
  const platformArch = getCurrentBoringsslPlatformArch()
  const sysrootDir: string = await ensureBoringssl(platformArch)
  const libSrc = path.join(sysrootDir, 'lib')
  const includeSrc = path.join(sysrootDir, 'include')
  if (!existsSync(libSrc) || !existsSync(includeSrc)) {
    throw new Error(
      `BoringSSL prebuilt missing lib/ or include/ at ${sysrootDir}; check boringssl-builder build output`,
    )
  }
  const depsBoringsslDir = path.join(
    ADDITIONS_SOURCE_PATCHED_DIR,
    'deps',
    'boringssl',
  )
  await safeMkdir(path.join(depsBoringsslDir, 'lib'))
  await safeMkdir(path.join(depsBoringsslDir, 'include'))
  await fs.cp(libSrc, path.join(depsBoringsslDir, 'lib'), {
    recursive: true,
    force: true,
  })
  await fs.cp(includeSrc, path.join(depsBoringsslDir, 'include'), {
    recursive: true,
    force: true,
  })
  logger.substep(`staged BoringSSL artifacts → ${depsBoringsslDir}`)
}

export async function prepareExternalSources(options: {
  buildMode: string
  platformArch: string
}) {
  const opts = { __proto__: null, ...options }
  logger.step('Preparing External Sources')

  // Stage VENDORED_SOURCES into additions/source-patched/ so the
  // vendor-patch hook can mutate the copy without touching the
  // submodule. Use `recursive: true` + `force: true` so existing
  // target files are overwritten. The `filter` skips dot-prefixed
  // DIRECTORIES (`.git`, `.github`, `.cache`, …) — upstream's VCS/CI
  // metadata isn't source the build needs, and a nested `.git` pointer
  // in the copy confuses tools that walk the tree. Dot-prefixed FILES
  // (`.gitignore`, `.gitattributes`, `.travis.yml`, …) still copy
  // through — they're cheap, harmless, and occasionally referenced by
  // upstream build scripts.
  // Targets that receive vendor patches (applyVendorPatches) must be wiped to
  // a pristine tree before each copy — see the clearing note below. Other
  // targets are left to merge: some hold committed files the upstream copy
  // doesn't restore (e.g. the tracked deps/libdeflate/libdeflate.gyp), which a
  // blanket wipe would destroy. Patched targets (deps/lsquic) are gitignored
  // vendored trees, so wiping them loses nothing.
  const patchedTargets = new Set(VENDOR_PATCH_BUNDLES.map(b => b.targetDir))
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const { from, to } of EXTERNAL_SOURCES) {
    if (!existsSync(from)) {
      throw new Error(`External source directory not found: ${from}`)
    }

    // fs.cp with force only overwrites files present in the source; it never
    // removes target files absent from it. For a patched target a stale
    // patch-created file (e.g. bun's lsquic versions-to-string) would persist
    // and get re-patched onto itself — stacking duplicate definitions. Wipe
    // patched targets first so every create-patch applies exactly once.
    if (patchedTargets.has(to)) {
      await safeDelete(to)
    }

    await fs.cp(from, to, {
      recursive: true,
      force: true,
      filter: src => !path.basename(src).startsWith('.') || !isDirSync(src),
    })

    const relativeFrom = path.relative(PACKAGE_ROOT, from)
    logger.success(`Copied directory tree from ${relativeFrom}`)
  }

  logger.log('')

  // Apply vendor patches AFTER the copy completes. Each bundle's
  // patches are rooted at deps/<name>/ relative to the vendor's own
  // tree, so applyPatch() runs with cwd=deps/<name> and patch -p1.
  await applyVendorPatches()

  logger.log('')

  // Emit per-dep gypi source manifests. Patch 004's smol target lists
  // `'includes': ['deps/<name>.gypi']` so each manifest is the
  // authoritative source list for its vendored library. Filesystem
  // walk + emit means a new upstream file appears in the build
  // automatically — no patch 004 update needed.
  await generateVendoredGypi()

  logger.log('')

  // Stage glibc-shims-infra (drop-in workspace package providing the
  // glibc 2.17 shim layer + canonical -Wl,--wrap link flags) into
  // deps/glibc-shims-infra/ so patch 004's
  // `includes: ['deps/glibc-shims-infra/glibc-shims-infra.gypi']`
  // resolves at gyp configure time.
  await copyGlibcShimsInfra()

  logger.log('')

  // Stage prebuilt BoringSSL (built by boringssl-builder with
  // -DBORINGSSL_PREFIX=smol) into deps/boringssl/{lib,include}/ so
  // patch 004's `dependencies: ['deps/boringssl/boringssl.gyp:boringssl']`
  // resolves at gyp configure time.
  await copyBoringsslArtifacts()

  logger.log('')

  await copySmolAiArtifacts(opts.buildMode, opts.platformArch)

  logger.log('')

  // Sync vendored npm packages after copying external sources.
  await syncVendoredPackages()
}

/**
 * Sync vendored npm packages from npm registry. These are external packages
 * that need ES→CJS conversion for Node.js additions.
 */
export async function syncVendoredPackages() {
  logger.step('Syncing Vendored Packages')

  // Sync fast-webstreams from npm registry.
  const syncScript = path.join(
    PACKAGE_ROOT,
    'scripts',
    'vendor-fast-webstreams',
    'sync.mts',
  )

  if (!existsSync(syncScript)) {
    throw new Error(`Vendor sync script not found: ${syncScript}`)
  }

  try {
    await spawn('node', [syncScript], {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
    })
    logger.success('Synced fast-webstreams from npm registry')
  } catch (e) {
    throw new Error(`Failed to sync fast-webstreams: ${errorMessage(e)}`, {
      cause: e,
    })
  }

  logger.log('')
}

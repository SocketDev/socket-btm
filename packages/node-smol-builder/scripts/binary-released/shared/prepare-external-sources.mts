/**
 * Prepare external sources for Node.js build.
 * Copies binject-core sources from monorepo packages to additions/ directory.
 * Syncs vendored npm packages (fast-webstreams) from npm registry.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { isDirSync } from '@socketsecurity/lib-stable/fs/inspect'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { ADDITIONS_SOURCE_PATCHED_DIR } from './paths.mts'
import { errorMessage } from 'build-infra/lib/error-utils'
import { applyPatch } from 'build-infra/lib/patch-validator'
import {
  BINJECT_DIR,
  BIN_INFRA_DIR,
  BUILD_INFRA_DIR,
  LIEF_BUILDER_DIR,
  LSQUIC_INFRA_DIR,
  PACKAGE_ROOT,
  TEMPORAL_INFRA_DIR,
  TUI_INFRA_DIR,
  YOGA_LAYOUT_BUILDER_DIR,
} from '../../paths.mts'

// Upstream liburing is in node-smol-builder/upstream/liburing (sibling to upstream/node).
const LIBURING_UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'liburing')

// Upstream md4c (CommonMark + GFM Markdown parser) is sibling to upstream/node.
// md4c.c + entity.c are compiled into the smol-markdown binding.
const MD4C_UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'md4c')

// Upstream tree-sitter (incremental parser library) is sibling to upstream/node.
// lib/src/lib.c is the umbrella TU that includes all parser sources;
// lib/include/tree_sitter/api.h is the public header consumed by the binding.
const TREE_SITTER_UPSTREAM_DIR = path.join(
  PACKAGE_ROOT,
  'upstream',
  'tree-sitter',
)

// Upstream libqrencode (QR code encoder) is sibling to upstream/node.
// All .c + .h files live at the root of the repo; we lift the whole
// set into src/socketsecurity/qrcode/libqrencode/ so sibling
// `#include "qrencode.h"` etc. inside libqrencode itself resolves.
const LIBQRENCODE_UPSTREAM_DIR = path.join(
  PACKAGE_ROOT,
  'upstream',
  'libqrencode',
)

// dawn-builder ships the prebuilt libwebgpu_dawn.a + headers (built
// by packages/dawn-builder/scripts/build.mts) that node:smol-webgpu
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
 *   - .gitmodules — every submodule SHA bump rewrites at least the
 *     version comment line, so hashing this file catches Dawn,
 *     md4c, tree-sitter, libqrencode, etc. bumps in one shot.
 *   - .config/lockstep.json — tracks pinned_sha for every upstream;
 *     hashing this is a redundant safety net.
 */
export const EXTERNAL_PIN_FILES = [
  path.join(PACKAGE_ROOT, '..', '..', '.gitmodules'),
  path.join(PACKAGE_ROOT, '..', '..', '.config', 'lockstep.json'),
]

// Upstream uSockets/uWebSockets for high-performance HTTP server (node:smol-http).
// uSockets provides direct epoll/kqueue event loop + raw socket I/O.
// uWebSockets provides HTTP parser (SWAR+bloom), cork buffer, response writer.
const USOCKETS_UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'uSockets')
const UWEBSOCKETS_UPSTREAM_DIR = path.join(
  PACKAGE_ROOT,
  'upstream',
  'uWebSockets',
)

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
 * Vendored / upstream source mappings — these come from submodules or
 * npm vendoring, NOT from the monorepo. They don't participate in the
 * SOURCE_PATCHED cache key (their content is pinned by submodule SHA
 * or version, not by file content).
 */
const VENDORED_SOURCES = [
  {
    from: path.join(BINJECT_DIR, 'upstream', 'libdeflate'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'libdeflate'),
  },
  // liburing: Linux io_uring library (upstream pinned in node-smol-builder/upstream/liburing).
  // Only the src/ directory is needed (contains sources and include/).
  // Only included on Linux where io_uring is available.
  ...(process.platform === 'linux'
    ? [
        {
          from: path.join(LIBURING_UPSTREAM_DIR, 'src'),
          to: path.join(
            ADDITIONS_SOURCE_PATCHED_DIR,
            'deps',
            'liburing',
            'src',
          ),
        },
      ]
    : []),
  // uSockets: High-performance socket library with libuv backend.
  // Provides direct event loop integration, raw socket I/O, and TCP optimizations.
  // We include the full src/ directory (C sources + internal headers).
  {
    from: path.join(USOCKETS_UPSTREAM_DIR, 'src'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'uSockets', 'src'),
  },
  // uWebSockets: High-performance HTTP/WebSocket library (header-only C++).
  // Provides custom SWAR HTTP parser, 16KB cork buffer, bloom filter headers,
  // zero-copy request parsing, and direct response writing.
  {
    from: path.join(UWEBSOCKETS_UPSTREAM_DIR, 'src'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'uWebSockets', 'src'),
  },
  // lsquic: LiteSpeed QUIC engine (node:smol-quic backend). Pinned to
  // v4.6.2 in lsquic-infra/upstream/lsquic. node.gyp consumes
  // deps/lsquic/src/liblsquic/*.c + deps/lsquic/include/ under the
  // use_smol_quic configure flag.
  {
    from: path.join(LSQUIC_INFRA_DIR, 'upstream', 'lsquic'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'lsquic'),
  },
  // ls-qpack: HTTP/3 header compression (QPACK). Pinned to v2.6.2 in
  // lsquic-infra/upstream/ls-qpack. node.gyp consumes deps/ls-qpack/lsqpack.c
  // under the use_smol_quic configure flag (HTTP/3 sits on top of QUIC).
  {
    from: path.join(LSQUIC_INFRA_DIR, 'upstream', 'ls-qpack'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'ls-qpack'),
  },
  // Yoga: Facebook's flexbox layout engine. The yoga-layout-builder
  // package submodules yoga's upstream tree; we lift the `yoga/`
  // subdir (the actual C++ sources + headers) under deps/yoga/ so
  // node.gyp can list them in the source list when --with-smol-tui
  // is enabled and #include "yoga/Yoga.h" works from binding glue.
  {
    from: path.join(YOGA_LAYOUT_BUILDER_DIR, 'upstream', 'yoga', 'yoga'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'yoga'),
  },
  // md4c: CommonMark + GFM Markdown parser. We lift the four source
  // files (md4c.c + md4c.h + entity.c + entity.h) into
  // src/socketsecurity/markdown/ alongside markdown_binding.cc so
  // `#include "md4c.h"` resolves via the existing 'src' include_dirs
  // entry without needing a new include path.
  {
    from: path.join(MD4C_UPSTREAM_DIR, 'src', 'md4c.c'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'markdown',
      'md4c.c',
    ),
  },
  {
    from: path.join(MD4C_UPSTREAM_DIR, 'src', 'md4c.h'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'markdown',
      'md4c.h',
    ),
  },
  {
    from: path.join(MD4C_UPSTREAM_DIR, 'src', 'entity.c'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'markdown',
      'entity.c',
    ),
  },
  {
    from: path.join(MD4C_UPSTREAM_DIR, 'src', 'entity.h'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'markdown',
      'entity.h',
    ),
  },
  // tree-sitter: incremental parser library. The lib/ directory holds
  // the umbrella lib.c (which includes every other .c via relative
  // path) + all internal headers (alloc.h, parser.h, ...) + the
  // public include/tree_sitter/api.h. We copy the whole subtree under
  // src/socketsecurity/tree_sitter/tree-sitter/ so:
  //   - tree_sitter_binding.cc's `#include
  //     "socketsecurity/tree_sitter/tree_sitter/api.h"` resolves
  //   - the umbrella lib.c's `#include "./*.c"` works (siblings stay
  //     adjacent inside lib/src/)
  {
    from: path.join(TREE_SITTER_UPSTREAM_DIR, 'lib'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'tree_sitter',
      'tree-sitter',
    ),
  },
  // libqrencode: QR code encoder. All .c + .h files live at repo root
  // and use sibling-relative #includes ("qrencode.h", "qrspec.h", ...).
  // Lifting the whole repo into src/socketsecurity/qrcode/libqrencode/
  // keeps siblings adjacent so the includes resolve. qrenc.c (CLI
  // tool with main()) is copied too but NOT listed in node.gyp, so
  // it's silently ignored at link time.
  {
    from: LIBQRENCODE_UPSTREAM_DIR,
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'qrcode',
      'libqrencode',
    ),
  },
]

const EXTERNAL_SOURCES = [...VENDORED_SOURCES]

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
      .sort()
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
 * Prepare external sources by copying them to additions directory.
 * Copies whole directory trees using fs.cp() with recursive flag.
 *
 * This is called before copyBuildAdditions() to ensure external sources
 * are available in the additions/ directory tree.
 */
export async function prepareExternalSources() {
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
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const { from, to } of EXTERNAL_SOURCES) {
    if (!existsSync(from)) {
      throw new Error(`External source directory not found: ${from}`)
    }

    await fs.cp(from, to, {
      recursive: true,
      force: true,
      filter: src =>
        !path.basename(src).startsWith('.') || !isDirSync(src),
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

  // Sync vendored npm packages after copying external sources.
  await syncVendoredPackages()
}

/**
 * Sync vendored npm packages from npm registry.
 * These are external packages that need ES→CJS conversion for Node.js additions.
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

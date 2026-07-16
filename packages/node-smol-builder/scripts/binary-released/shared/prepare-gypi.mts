/**
 * Gypi manifest generation for vendored deps.
 *
 * Walks the additions/source-patched/ tree for each vendored dep and emits
 * a .gypi source-list fragment that patch 004 includes. Split from
 * prepare-external-sources.mts to keep each file under the 500-line soft cap.
 */

import { existsSync, promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { ADDITIONS_SOURCE_PATCHED_DIR } from './paths.mts'

const logger = getDefaultLogger()

const VENDORED_GYPI_BUNDLES: ReadonlyArray<{
  readonly name: string
  // Walk root, relative to additions/source-patched/.
  readonly walkRoot: string
  // gypi output path, relative to additions/source-patched/.
  readonly gypiOut: string
  // Each extension is matched against file suffix. .c + .cpp = sources;
  // .h headers aren't compile units so they're excluded.
  readonly extensions: readonly string[]
  // Subpath filter — skip paths whose substring matches any of these
  // (tests/, fuzz/, bin/ standalone tools, etc.).
  readonly skipSubstrings: readonly string[]
  // Exact-basename filter — skip files whose basename matches one of
  // these. Used for non-compile data blobs that look like .c sources
  // but aren't listed by upstream's build manifest.
  readonly skipBasenames?: readonly string[] | undefined
  // Preprocessor defines to emit into the gypi. gyp merges an `included`
  // gypi's `'defines'` into the parent target, so these reach the dep's
  // own translation units. Used where the dep's CMake build sets a define
  // the gyp build otherwise omits (e.g. lsquic's HAVE_BORINGSSL, which
  // selects its BoringSSL crypto branch over the OpenSSL one).
  readonly defines?: readonly string[] | undefined
  // Compiler flags to emit into the gypi. Used to relax node's strict
  // -Werror set for vendored third-party C we don't maintain (e.g.
  // xxhash/lsquic/lsqpack trip -Werror=extra-semi on trailing semicolons
  // in their macros). gyp merges these into the consuming target.
  readonly cflags?: readonly string[] | undefined
}> = [
  {
    name: 'yoga',
    walkRoot: 'deps/yoga',
    gypiOut: 'deps/yoga.gypi',
    extensions: ['.cpp'],
    skipSubstrings: ['/test/', '/tests/', '/bench/', '/benchmark/'],
  },
  {
    name: 'lsquic',
    walkRoot: 'deps/lsquic/src/liblsquic',
    gypiOut: 'deps/lsquic.gypi',
    extensions: ['.c'],
    skipSubstrings: ['/test/', '/tests/', '/fuzz/', '/bin/'],
    // common_cert_set_2.c / common_cert_set_3.c are pre-generated cert
    // BLOB data files included from lsquic_crt_compress.c via `#include`,
    // NOT compile units. lsquic's CMakeLists never lists them; treating
    // them as sources surfaces `unknown type name 'size_t'` because they
    // intentionally have no preamble.
    skipBasenames: ['common_cert_set_2.c', 'common_cert_set_3.c'],
    // node-smol links lsquic against BoringSSL. lsquic_crypto.c gates its
    // HKDF call on HAVE_BORINGSSL (BoringSSL spells it EVP_PKEY_CTX_hkdf_mode;
    // the OpenSSL #else branch's EVP_PKEY_CTX_set_hkdf_mode is absent from
    // BoringSSL). CMake sets HAVE_BORINGSSL on detection; the gyp build must
    // too or the compile fails with an undeclared-function error.
    defines: ['HAVE_BORINGSSL'],
    // Vendored third-party C: relax node's strict -Werror set rather than
    // rewriting upstream style (trailing semicolons in macros via the
    // bundled xxhash; inline funcs referenced only cross-TU).
    cflags: ['-Wno-error=extra-semi', '-Wno-error=undefined-inline'],
  },
  {
    name: 'ls-qpack',
    walkRoot: 'deps/ls-qpack',
    gypiOut: 'deps/ls-qpack.gypi',
    extensions: ['.c'],
    // ls-qpack ships top-level test/, fuzz/, bin/ dirs; only lsqpack.c
    // at the root + huff-tables.h (header) are library content. Note
    // `/deps/` would match the walk root itself — keep substring
    // filters specific to subdirs under the walk root.
    skipSubstrings: ['/test/', '/tests/', '/fuzz/', '/bin/'],
    // Vendored third-party C (lsqpack.c + its bundled xxhash): relax the
    // strict -Werror set, same rationale as lsquic.
    cflags: ['-Wno-error=extra-semi', '-Wno-error=undefined-inline'],
  },
  {
    // ls-hpack (HPACK) — lsquic's HTTP/2 header compression, consumed by
    // lsquic_frame_{reader,writer}.c + lsquic_full_conn.c via `#include
    // "lshpack.h"`. It lives in lsquic's own src/lshpack submodule (no
    // standalone vendor like ls-qpack), so the walk root is inside the
    // lsquic copy. Compile only lshpack.c; its test/, bin/, and bundled
    // deps/xxhash are excluded — XXH_INLINE_ALL makes xxhash header-only
    // for lshpack.c (XXH_HEADER_NAME is lshpack's own CMake default), so
    // no separate xxhash.c object collides with zstd's namespaced copy.
    name: 'lshpack',
    walkRoot: 'deps/lsquic/src/lshpack',
    gypiOut: 'deps/lshpack.gypi',
    extensions: ['.c'],
    skipSubstrings: ['/test/', '/tests/', '/bin/', '/lshpack/deps/'],
    defines: ['XXH_INLINE_ALL', 'XXH_HEADER_NAME="xxhash.h"'],
    // Vendored third-party C (lshpack.c + inlined xxhash): relax the strict
    // -Werror set, same rationale as lsquic.
    cflags: ['-Wno-error=extra-semi', '-Wno-error=undefined-inline'],
  },
]

/**
 * Walk a directory tree, collecting source files whose suffix matches
 * one of `extensions` and whose path doesn't contain any of
 * `skipSubstrings`. Returns paths normalized to forward slashes and
 * sorted for deterministic gypi output.
 */
// oxlint-disable-next-line socket/sort-source-methods -- helper defined before its only caller (generateVendoredGypi); keeping the definition adjacent to the call site reads better than alphabetizing this set of exports.
// oxlint-disable-next-line socket/export-top-level-functions -- internal helper for generateVendoredGypi; not consumed externally.
async function walkSources(
  root: string,
  extensions: readonly string[],
  skipSubstrings: readonly string[],
  skipBasenames: readonly string[] = [],
): Promise<readonly string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const suffix = path.extname(entry.name)
      if (!extensions.includes(suffix)) {
        continue
      }
      const normalized = full.split(path.sep).join('/')
      let skip = false
      for (let j = 0, sl = skipSubstrings.length; j < sl; j += 1) {
        if (normalized.includes(skipSubstrings[j]!)) {
          skip = true
          break
        }
      }
      if (skip) {
        continue
      }
      if (skipBasenames.includes(entry.name)) {
        continue
      }
      out.push(normalized)
    }
  }
  await walk(root)
  out.sort()
  return out
}

/**
 * Emit per-dep gypi source manifests under additions/source-patched/deps/.
 * Each manifest is a sources-only fragment patch 004 pulls in via
 * `'includes':`. Filesystem walk → emit decouples the source list from
 * the patch, so a new upstream file appears in the build automatically.
 */
export async function generateVendoredGypi(): Promise<void> {
  logger.step('Generating vendored-dep gypi manifests')
  for (let i = 0, { length } = VENDORED_GYPI_BUNDLES; i < length; i += 1) {
    const bundle = VENDORED_GYPI_BUNDLES[i]!
    const absoluteWalkRoot = path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      bundle.walkRoot,
    )
    if (!existsSync(absoluteWalkRoot)) {
      logger.substep(
        `${bundle.name}: walk root absent (${bundle.walkRoot}); skipping`,
      )
      continue
    }
    const sources = await walkSources(
      absoluteWalkRoot,
      bundle.extensions,
      bundle.skipSubstrings,
      bundle.skipBasenames,
    )
    if (sources.length === 0) {
      logger.substep(
        `${bundle.name}: no sources found under ${bundle.walkRoot}`,
      )
      continue
    }
    // gyp resolves source paths inside an `'includes':`-d gypi RELATIVE
    // TO THAT GYPI'S OWN LOCATION, not the parent gyp file. The gypi
    // sits at <source>/deps/<name>.gypi after the additions copy, so
    // paths must be relative to <source>/deps/, not <source>/. Strip
    // the gypi's parent dir from the source path. Emit forward-slash
    // paths; gyp normalizes per-host.
    const gypiParent = path.dirname(
      path.join(ADDITIONS_SOURCE_PATCHED_DIR, bundle.gypiOut),
    )
    const relSources = sources.map(s =>
      path.relative(gypiParent, s).split(path.sep).join('/'),
    )
    const lines: string[] = []
    lines.push('# Auto-generated by prepare-external-sources.mts.')
    lines.push(`# Sources for vendored ${bundle.name}; included by patch 004.`)
    lines.push(
      '# DO NOT HAND-EDIT — re-run prepareExternalSources() to refresh.',
    )
    lines.push('{')
    lines.push("  'sources': [")
    for (let j = 0, sl = relSources.length; j < sl; j += 1) {
      lines.push(`    '${relSources[j]}',`)
    }
    lines.push('  ],')
    if (bundle.defines?.length) {
      lines.push("  'defines': [")
      for (const d of bundle.defines) {
        lines.push(`    '${d}',`)
      }
      lines.push('  ],')
    }
    if (bundle.cflags?.length) {
      lines.push("  'cflags': [")
      for (const c of bundle.cflags) {
        lines.push(`    '${c}',`)
      }
      lines.push('  ],')
    }
    lines.push('}')
    const outPath = path.join(ADDITIONS_SOURCE_PATCHED_DIR, bundle.gypiOut)
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, lines.join('\n') + '\n', 'utf8')
    logger.substep(
      `${bundle.name}: emitted ${sources.length} sources → ${bundle.gypiOut}`,
    )
  }
  logger.success('Vendored gypi manifests generated')
}

/**
 * Path-remap flags for compiled artifacts.
 *
 * Compiled output (WASM, .node addons, .so/.dylib/.a, native binaries) routinely
 * embeds the absolute build-host paths of source files into:
 *   - DWARF debug info     (clang/gcc/rustc)
 *   - __FILE__ macros      (anything that calls assert(), and a lot of crates)
 *   - Rust panic messages  (file:line)
 *   - Cargo registry paths (~/.cargo/registry/src/index.crates.io-.../<crate>/...)
 *
 * That leaks usernames, project layouts, and home-directory structure into
 * artifacts we ship to the public. The fix is to pass path-prefix-map flags so
 * the compiler rewrites those absolute paths to stable, anonymous prefixes
 * (/cargo, /home, /build) before they hit the artifact.
 *
 * This module is the canonical source for those flags. Consumers:
 *   - C/C++ builds (cmake, configure, raw cc/clang/clang++): use cflags/cxxflags
 *   - Emscripten builds: same flags work — clang accepts them
 *   - Rust/cargo builds: use rustflags joined into RUSTFLAGS or
 *     CARGO_ENCODED_RUSTFLAGS env var
 *   - Go builds: -trimpath already covers Go-side paths, but CGO needs the
 *     C/C++ flags via CGO_CFLAGS / CGO_CXXFLAGS
 *
 * The mappings are deliberately fixed strings so the same source path produces
 * the same anonymized output regardless of which dev machine or CI runner did
 * the build. Reproducibility is preserved; only the prefix changes.
 */

import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ANON_HOME = '/home'
const ANON_CARGO_HOME = '/cargo'
const ANON_BUILD = '/build'

/**
 * Resolve the canonical path-remap source paths from the current environment.
 * Each entry is `<absolute-path-on-build-host>=<anonymized-prefix>`.
 *
 * Order matters for `-ffile-prefix-map` and `--remap-path-prefix`: the first
 * matching prefix wins, so longer/more-specific paths must come first.
 */
function getRemapPairs() {
  const home = os.homedir()
  const cargoHome = process.env['CARGO_HOME'] || path.join(home, '.cargo')
  const projectRoot = process.cwd()

  const pairs = []
  // Cargo registry/cache lives under CARGO_HOME — must remap before $HOME so
  // the more specific prefix wins.
  pairs.push([cargoHome, ANON_CARGO_HOME])
  // The project root is what __FILE__ + DWARF source paths resolve against.
  // Map it before $HOME so a project under $HOME still gets /build, not /home/...
  if (projectRoot !== home && !projectRoot.startsWith(cargoHome + path.sep)) {
    pairs.push([projectRoot, ANON_BUILD])
  }
  pairs.push([home, ANON_HOME])
  return pairs
}

/**
 * C/C++ flags (-ffile-prefix-map=...). Works with clang, gcc, and Emscripten's
 * em++/emcc. `-ffile-prefix-map` is a superset of `-fdebug-prefix-map` and
 * `-fmacro-prefix-map`, so this single flag covers DWARF source paths and
 * `__FILE__` macro expansions.
 */
export function getCCRemapFlags() {
  return getRemapPairs().map(([from, to]) => `-ffile-prefix-map=${from}=${to}`)
}

/**
 * Rust flags (--remap-path-prefix). Each pair becomes its own `--remap-path-prefix`
 * argument; rustc reads them in order and applies them to source-file paths in
 * DWARF, panic messages, and any path-bearing diagnostics that survive into
 * the binary.
 */
export function getRustcRemapFlags() {
  return getRemapPairs().map(([from, to]) => `--remap-path-prefix=${from}=${to}`)
}

/**
 * Encoded RUSTFLAGS for Cargo's CARGO_ENCODED_RUSTFLAGS env var. Cargo expects
 * 0x1f-separated tokens. This form lets us pass flags containing spaces (none
 * of the remap paths do, but stay correct by construction).
 *
 * Pass an optional `extraFlags` array (e.g. perf flags from a Cargo
 * config.toml that we'd otherwise lose by setting RUSTFLAGS) and they're
 * concatenated after the remap flags.
 */
export function getEncodedRustflags(extraFlags = []) {
  const all = [...getRustcRemapFlags(), ...extraFlags]
  return all.join('')
}

/**
 * Append remap flags to an existing CFLAGS / CXXFLAGS / EMCC_CFLAGS /
 * CGO_CFLAGS env value. Returns the combined string suitable for assignment.
 * If `existing` is empty/undefined, returns just the remap flags.
 */
export function appendCCRemapFlags(existing) {
  const remap = getCCRemapFlags().join(' ')
  const trimmed = (existing || '').trim()
  return trimmed ? `${trimmed} ${remap}` : remap
}

/**
 * Build a partial env object that adds path-remap flags to all the standard
 * compiler/linker env vars. Merges with existing values rather than replacing.
 *
 * Use this when calling out to a build that respects env vars (autoconf
 * configure, raw makefile builds without explicit CFLAGS forwarding, etc.)
 *
 * The returned object is shaped for `{ ...process.env, ...getCCRemapEnv() }`
 * spread.
 */
export function getCCRemapEnv(existingEnv = process.env) {
  const out = { __proto__: null }
  for (const key of [
    'CFLAGS',
    'CXXFLAGS',
    'CPPFLAGS',
    'EMCC_CFLAGS',
    'EMCC_CXXFLAGS',
    'CGO_CFLAGS',
    'CGO_CXXFLAGS',
  ]) {
    out[key] = appendCCRemapFlags(existingEnv[key])
  }
  return out
}

/**
 * Make-style space-joined version of the remap flags. Useful for embedding
 * into makefile variables or cmake `-DCMAKE_C_FLAGS=...` arguments.
 */
export function getCCRemapFlagsString() {
  return getCCRemapFlags().join(' ')
}

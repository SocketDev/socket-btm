/**
 * Vendored and upstream source mappings for the Node.js build.
 *
 * Declares the directories that prepare-external-sources copies into
 * additions/source-patched/. Split from prepare-external-sources.mts to keep
 * each file under the 500-line soft cap.
 */

import path from 'node:path'
import process from 'node:process'

import { ADDITIONS_SOURCE_PATCHED_DIR } from './paths.mts'
import {
  BINJECT_DIR,
  LSQUIC_INFRA_DIR,
  PACKAGE_ROOT,
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
// set into src/socketsecurity/deps/qrcode/upstream/libqrencode/ so sibling
// `#include "qrencode.h"` etc. inside libqrencode itself resolves.
const LIBQRENCODE_UPSTREAM_DIR = path.join(
  PACKAGE_ROOT,
  'upstream',
  'libqrencode',
)

// Upstream uSockets/uWebSockets for high-performance HTTP server (node:smol-http).
// uSockets provides direct epoll/kqueue event loop + raw socket I/O.
// uWebSockets provides HTTP parser (SWAR+bloom), cork buffer, response writer.
const USOCKETS_UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'uSockets')
const UWEBSOCKETS_UPSTREAM_DIR = path.join(
  PACKAGE_ROOT,
  'upstream',
  'uWebSockets',
)

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
  // src/socketsecurity/deps/markdown/upstream/ — markdown_binding.cc sits at
  // src/socketsecurity/deps/markdown/ (one level up, tracked first-party).
  // The `upstream/` segment lets the existing **/upstream/** .gitignore rule
  // ignore the copied tree generically. `#include "md4c.h"` resolves via the
  // existing 'src' include_dirs entry plus the binding's relative `#include`.
  {
    from: path.join(MD4C_UPSTREAM_DIR, 'src', 'md4c.c'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'deps',
      'markdown',
      'upstream',
      'md4c.c',
    ),
  },
  {
    from: path.join(MD4C_UPSTREAM_DIR, 'src', 'md4c.h'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'deps',
      'markdown',
      'upstream',
      'md4c.h',
    ),
  },
  {
    from: path.join(MD4C_UPSTREAM_DIR, 'src', 'entity.c'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'deps',
      'markdown',
      'upstream',
      'entity.c',
    ),
  },
  {
    from: path.join(MD4C_UPSTREAM_DIR, 'src', 'entity.h'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'deps',
      'markdown',
      'upstream',
      'entity.h',
    ),
  },
  // tree-sitter: incremental parser library. The lib/ directory holds
  // the umbrella lib.c (which includes every other .c via relative
  // path) + all internal headers (alloc.h, parser.h, ...) + the
  // public include/tree_sitter/api.h. We copy the whole subtree under
  // src/socketsecurity/deps/tree_sitter/upstream/tree-sitter/ so:
  //   - tree_sitter_binding.cc's `#include
  //     "socketsecurity/deps/tree_sitter/upstream/tree-sitter/include/tree_sitter/api.h"` resolves
  //   - the umbrella lib.c's `#include "./*.c"` works (siblings stay
  //     adjacent inside lib/src/)
  // The `upstream/` segment lets the existing **/upstream/** .gitignore rule
  // ignore the copied tree generically — no per-lib .gitignore lines needed.
  {
    from: path.join(TREE_SITTER_UPSTREAM_DIR, 'lib'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'deps',
      'tree_sitter',
      'upstream',
      'tree-sitter',
    ),
  },
  // libqrencode: QR code encoder. All .c + .h files live at repo root
  // and use sibling-relative #includes ("qrencode.h", "qrspec.h", ...).
  // Lifting the whole repo into src/socketsecurity/deps/qrcode/upstream/libqrencode/
  // keeps siblings adjacent so the includes resolve. qrenc.c (CLI
  // tool with main()) is copied too but NOT listed in node.gyp, so
  // it's silently ignored at link time.
  {
    from: LIBQRENCODE_UPSTREAM_DIR,
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'deps',
      'qrcode',
      'upstream',
      'libqrencode',
    ),
  },
]

export const EXTERNAL_SOURCES = [...VENDORED_SOURCES]

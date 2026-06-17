# smol-tree-sitter.js -- Public API for tree-sitter (node:smol-tree-sitter)

## What This File Does

This is the entry point for `require('node:smol-tree-sitter')`. It
exposes the tree-sitter incremental parser library (C, MIT, vendored
as a submodule at `upstream/tree-sitter` and built into the smol
binary). Replaces userland `web-tree-sitter` WASM dep on the syntax-
highlighting Code renderable path.

## How It Fits Together

```
require('node:smol-tree-sitter') -> this file (smol-tree-sitter.js)
  -> internalBinding('smol_tree_sitter') (C++ native binding)
    -> tree-sitter (vendored at upstream/tree-sitter; lib/src/lib.c is
                    the umbrella TU that #includes every other .c)
```

The C++ binding lives at
`additions/source-patched/src/socketsecurity/deps/tree_sitter/tree_sitter_binding.cc`.
Languages (grammars) are loaded at runtime via `dlopen` from a `.dylib`
/ `.so` / `.dll` built from a tree-sitter grammar repo's `src/parser.c`.

## Public API

```ts
import { freeLanguage, loadLanguage, parse } from 'node:smol-tree-sitter'

// loadLanguage(path, symbol) -> handle | 0
// dlopens `path` and resolves `symbol` (the language factory, typically
// `tree_sitter_<lang>`). Returns an opaque integer handle.
const js = loadLanguage(
  '/usr/local/lib/tree-sitter-javascript.dylib',
  'tree_sitter_javascript',
)
if (js === 0) {
  throw new Error('failed to load tree-sitter-javascript')
}

// parse(handle, source) -> Array<[type, startByte, endByte, namedChildCount]>
// Pre-order traversal of named nodes. Skips anonymous punctuation
// nodes (they don't matter for highlighters).
const nodes = parse(js, 'const x = 42;')
// [
//   ['program', 0, 13, 1],
//   ['lexical_declaration', 0, 13, 1],
//   ['variable_declarator', 6, 12, 2],
//   ['identifier', 6, 7, 0],
//   ['number', 10, 12, 0],
// ]

// freeLanguage(handle): release the dlopen handle.
freeLanguage(js)
```

## Design Choices

**dlopen-based grammar loading.** tree-sitter grammars are
distributed as platform-specific shared libraries. WASM grammars
(via `web-tree-sitter`) work in browsers but cost ~500 KB of WASM
runtime overhead per parser. Native `dlopen` is one syscall and
~100 µs of overhead, with zero per-parse runtime cost.

**Flat span list output.** Same rationale as `node:smol-markdown` —
building a V8 object graph from C++ per node would multiply handle
count by 4-5x. The flat `[type, start, end, child_count]` array is
two allocations per node (outer + inner array). Consumers
interested in the full tree structure reconstruct it from
`child_count` + pre-order ordering in JS (one linear pass).

**Skip anonymous nodes.** tree-sitter emits both named nodes (e.g.
`function_declaration`) and anonymous punctuation nodes (e.g. `{`,
`,`). Highlighters only care about named nodes. Filtering at the C++
boundary keeps the JS work proportional to the highlighting cost.

**No query support yet.** tree-sitter's "query" feature
(highlights.scm + injections.scm) is the right primitive for a
syntax-highlight consumer. That's a follow-up binding — the basic
parse + walk shape ships first to validate the loading mechanism.

## Building Grammars

Grammar repos publish their generated `parser.c` in `src/`. To build
a loadable .dylib:

```sh
git clone https://github.com/tree-sitter/tree-sitter-javascript
cd tree-sitter-javascript
cc -shared -fPIC -O2 -Isrc src/parser.c src/scanner.c \
  -o tree-sitter-javascript.dylib
```

The library is then ready to pass to `loadLanguage`. Cross-compile
for the target OS/arch as needed.

## Where the Real Work Happens

The binding's design rationale is at the top of
`tree_sitter_binding.cc`. Upstream tree-sitter lives at
`packages/node-smol-builder/upstream/tree-sitter/` (submodule, pinned
in `.config/lockstep.json`).

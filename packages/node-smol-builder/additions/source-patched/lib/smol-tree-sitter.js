'use strict'

// node:smol-tree-sitter — tree-sitter incremental parser library.
// Backed by tree-sitter/tree-sitter v0.26.9 (C, MIT).
//
// Tree-sitter parses source code into a concrete syntax tree. We
// expose just the parts that the syntax-highlighting hot path needs:
// load a compiled grammar from a shared library, parse a source
// string, get back a flat span list.
//
// Surface:
//
//   loadLanguage(path, symbol) -> handle | 0
//     dlopens `path` (e.g. `/usr/lib/tree-sitter-javascript.dylib`)
//     and resolves `symbol` (e.g. `tree_sitter_javascript`) as the
//     language factory. Returns an opaque integer handle.
//
//   freeLanguage(handle): release the language.
//
//   parse(handle, source) -> Array<[type, start, end, named_child_count]>
//     Pre-order traversal of the named nodes in the parse tree.
//     `type` is the grammar's node-type name (e.g. `function_declaration`).
//     `start` / `end` are byte offsets into source.
//
// Grammars are not bundled — consumers ship the `.dylib` / `.so` /
// `.dll` separately. Build grammars via:
//
//   tree-sitter generate
//   cc -shared -fPIC src/parser.c -o tree-sitter-<lang>.dylib
//
// See https://tree-sitter.github.io/tree-sitter/creating-parsers for
// the grammar authoring guide.

const { ObjectFreeze } = primordials

const { freeLanguage, loadLanguage, parse } = internalBinding(
  'smol_tree_sitter',
)

module.exports = ObjectFreeze({
  __proto__: null,
  freeLanguage,
  loadLanguage,
  parse,
})

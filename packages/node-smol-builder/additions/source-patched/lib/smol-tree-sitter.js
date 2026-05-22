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

const { freeLanguage, loadLanguage, parse, parseStream } = internalBinding(
  'smol_tree_sitter',
)

// parseStream(handle, source) -> ArrayBuffer
//
// Zero-copy variant of parse(). Returns a SINGLE ArrayBuffer in this
// binary format (matches markdown's parseMarkdownStream shape):
//
//   Header (12 bytes, little-endian):
//     uint32 magic              = 0x53545356 ("STSV")
//     uint32 node_count
//     uint32 type_pool_size_bytes
//
//   Node records (20 bytes × node_count):
//     uint32 type_offset        // RELATIVE to type-pool start
//     uint32 type_len
//     uint32 start_byte
//     uint32 end_byte
//     uint32 named_child_count
//
//   Type pool (type_pool_size_bytes bytes):
//     Concatenated UTF-8 type names. Interned per parse — duplicates
//     reuse the same pool offset.
//
// Use this for syntax highlighters that iterate ~10k+ nodes per file.
// The Array-of-arrays form (parse()) costs 50-80 ns per node in V8
// allocation overhead; parseStream is ~1 ns per node (single memcpy).

const STREAM_MAGIC = 0x53545356  // "STSV"
const STREAM_HEADER_SIZE = 12
const STREAM_RECORD_SIZE = 20
const sharedDecoder = new TextDecoder('utf-8')

function decodeStream(arrayBuffer) {
  if (
    !arrayBuffer ||
    typeof arrayBuffer.byteLength !== 'number' ||
    arrayBuffer.byteLength < STREAM_HEADER_SIZE
  ) {
    throw new TypeError(
      'parseStream output too small to be a valid tree-sitter stream',
    )
  }
  const header = new DataView(arrayBuffer, 0, STREAM_HEADER_SIZE)
  const magic = header.getUint32(0, true)
  if (magic !== STREAM_MAGIC) {
    throw new TypeError(
      `parseStream output has wrong magic ${magic.toString(16)}; expected STSV`,
    )
  }
  const nodeCount = header.getUint32(4, true)
  const typePoolSize = header.getUint32(8, true)
  const recordsByteSize = nodeCount * STREAM_RECORD_SIZE
  const records = new DataView(
    arrayBuffer,
    STREAM_HEADER_SIZE,
    recordsByteSize,
  )
  const typePool = new Uint8Array(
    arrayBuffer,
    STREAM_HEADER_SIZE + recordsByteSize,
    typePoolSize,
  )
  return {
    __proto__: null,
    nodeCount,
    records,
    typePool,
  }
}

// streamForEach(buf, fn): iterates the decoded stream, calling
// `fn({ type, startByte, endByte, namedChildCount })` for each
// node. Type strings are TextDecoder-decoded lazily; with the type
// pool interning identical types share one decode pass on first
// use (cached by call site, not by us — V8's string-table dedupes).
function streamForEach(arrayBuffer, fn) {
  const { nodeCount, records, typePool } = decodeStream(arrayBuffer)
  for (let i = 0, byteOff = 0; i < nodeCount; i += 1, byteOff += STREAM_RECORD_SIZE) {
    const typeOffset = records.getUint32(byteOff, true)
    const typeLen = records.getUint32(byteOff + 4, true)
    const startByte = records.getUint32(byteOff + 8, true)
    const endByte = records.getUint32(byteOff + 12, true)
    const namedChildCount = records.getUint32(byteOff + 16, true)
    const type = sharedDecoder.decode(
      typePool.subarray(typeOffset, typeOffset + typeLen),
    )
    fn(type, startByte, endByte, namedChildCount)
  }
}

module.exports = ObjectFreeze({
  __proto__: null,
  decodeStream,
  freeLanguage,
  loadLanguage,
  parse,
  parseStream,
  streamForEach,
})

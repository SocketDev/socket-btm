'use strict'

// node:smol-markdown — CommonMark + GFM Markdown parser backed by md4c
// (https://github.com/mity/md4c). Replaces userland `marked` /
// `remark` / `markdown-it` on the AI-output rendering hot path.
//
// Surface:
//
//   parseMarkdown(text, flags?) -> Array<[code, payload]>
//     Returns a flat event stream. Each event is a 2-tuple:
//       [0]: numeric code combining a category nibble (high 4 bits)
//            and an md4c enum value (low 12 bits).
//       [1]: undefined | string (text content) | number (heading level)
//
//     Categories:
//       0: block enter   (BLOCKTYPE in low bits)
//       1: block leave   (BLOCKTYPE in low bits)
//       2: span enter    (SPANTYPE  in low bits)
//       3: span leave    (SPANTYPE  in low bits)
//       4: text          (TEXTTYPE  in low bits)
//
//     BLOCKTYPE / SPANTYPE / TEXTTYPE numeric values are also exposed
//     as frozen enum objects on this module's exports so callers can
//     dispatch by name instead of magic numbers.
//
//   blockType / spanType / textType: frozen objects mapping enum
//   names to numeric values (1:1 mirror of md4c.h).
//
//   eventCategory: frozen object with the five high-nibble codes.
//
//   parseTree(text, flags?) -> { type: 'doc', children: [...] }
//     Convenience wrapper around parseMarkdown that reconstructs a
//     nested tree from the flat event stream. Builds a JS object
//     graph; use parseMarkdown directly for the hot path.
//
// flags is a comma-separated subset of md4c flag names (case
// insensitive). Supported tokens:
//
//   collapse_whitespace, permissive_atx_headers,
//   permissive_url_autolinks, permissive_email_autolinks,
//   permissive_www_autolinks, no_indented_code_blocks,
//   no_html_blocks, no_html_spans, tables, strikethrough,
//   tasklists, latex_math_spans, wikilinks, underline,
//   hard_soft_breaks, commonmark, github
//
// `commonmark` is the empty set (no extensions). `github` is the
// MD_DIALECT_GITHUB aggregate (tables + strikethrough + tasklists +
// permissive_*_autolinks).

const {
  ArrayPrototypePush,
  DataView: DataViewCtor,
  DataViewPrototypeGetInt32,
  DataViewPrototypeGetUint32,
  NumberPrototypeToString,
  ObjectFreeze,
  TypeError: TypeErrorCtor,
  Uint8Array: Uint8ArrayCtor,
  Uint8ArrayPrototypeSubarray,
} = primordials

const { parseMarkdown, parseMarkdownStream } =
  internalBinding('smol_markdown')

// Mirror md4c.h enums. Numeric values are stable across md4c releases
// (per their semver policy); we re-export them for callers that want
// to dispatch by name. Keep in sync with src/md4c.h when bumping md4c.
const blockType = ObjectFreeze({
  __proto__: null,
  DOC: 0,
  QUOTE: 1,
  UL: 2,
  OL: 3,
  LI: 4,
  HR: 5,
  H: 6,
  CODE: 7,
  HTML: 8,
  P: 9,
  TABLE: 10,
  THEAD: 11,
  TBODY: 12,
  TR: 13,
  TH: 14,
  TD: 15,
})

const spanType = ObjectFreeze({
  __proto__: null,
  EM: 0,
  STRONG: 1,
  A: 2,
  IMG: 3,
  CODE: 4,
  DEL: 5,
  LATEXMATH: 6,
  LATEXMATH_DISPLAY: 7,
  WIKILINK: 8,
  U: 9,
})

const textType = ObjectFreeze({
  __proto__: null,
  NORMAL: 0,
  NULLCHAR: 1,
  ENTITY: 2,
  CODE: 3,
  HTML: 4,
  LATEXMATH: 5,
})

const eventCategory = ObjectFreeze({
  __proto__: null,
  BLOCK_ENTER: 0 << 12,
  BLOCK_LEAVE: 1 << 12,
  SPAN_ENTER: 2 << 12,
  SPAN_LEAVE: 3 << 12,
  TEXT: 4 << 12,
})

const CATEGORY_MASK = 0xf000
const VALUE_MASK = 0x0fff

// parseMarkdownStream layout constants. Must stay in sync with the
// native binding's ParseMarkdownStream (markdown_binding.cc).
const STREAM_MAGIC = 0x534d4456  // "SMDV"
const STREAM_HEADER_SIZE = 12
const STREAM_EVENT_SIZE = 16

// decodeStream(buf) -> { code: Uint32Array, textOffsets: Uint32Array,
//                       textLens: Uint32Array, headingLevels: Int32Array,
//                       textPool: Uint8Array }
//
// Slices the native ArrayBuffer into typed-array views — no copies.
// Consumers iterate the parallel arrays; the textPool is a single
// Uint8Array view sliced via subarray() for each event's payload.
function decodeStream(arrayBuffer) {
  if (
    !arrayBuffer ||
    typeof arrayBuffer.byteLength !== 'number' ||
    arrayBuffer.byteLength < STREAM_HEADER_SIZE
  ) {
    throw new TypeErrorCtor(
      'parseMarkdownStream output too small to be a valid event stream',
    )
  }
  const header = new DataViewCtor(arrayBuffer, 0, STREAM_HEADER_SIZE)
  const magic = DataViewPrototypeGetUint32(header, 0, true)
  if (magic !== STREAM_MAGIC) {
    throw new TypeErrorCtor(
      `parseMarkdownStream output has wrong magic ${NumberPrototypeToString(magic, 16)}; expected SMDV`,
    )
  }
  const eventCount = DataViewPrototypeGetUint32(header, 4, true)
  const textPoolSize = DataViewPrototypeGetUint32(header, 8, true)
  const recordsByteSize = eventCount * STREAM_EVENT_SIZE
  // Typed-array views into the shared ArrayBuffer — zero-copy.
  const records = new DataViewCtor(
    arrayBuffer,
    STREAM_HEADER_SIZE,
    recordsByteSize,
  )
  const textPool = new Uint8ArrayCtor(
    arrayBuffer,
    STREAM_HEADER_SIZE + recordsByteSize,
    textPoolSize,
  )
  return {
    __proto__: null,
    eventCount,
    records,
    textPool,
  }
}

// streamForEach(buf, fn): iterates the decoded stream, calling
// `fn(code, payload)` for each event. Text payloads are decoded
// only when present (TextDecoder cost paid per text event, not
// per total event). Callers that don't need text strings can use
// decodeStream() directly and read the records/textPool typed
// arrays.
// TextDecoder is a WHATWG global, not part of Node's `primordials` —
// safe to capture the constructor at module load and the prototype
// method via uncurry to avoid prototype-mutation risk on the hot path.
const sharedDecoder = new TextDecoder('utf-8')
const sharedDecode = TextDecoder.prototype.decode
function streamForEach(arrayBuffer, fn) {
  const { eventCount, records, textPool } = decodeStream(arrayBuffer)
  for (let i = 0, byteOff = 0; i < eventCount; i += 1, byteOff += STREAM_EVENT_SIZE) {
    const code = DataViewPrototypeGetUint32(records, byteOff, true)
    const textOffset = DataViewPrototypeGetUint32(records, byteOff + 4, true)
    const textLen = DataViewPrototypeGetUint32(records, byteOff + 8, true)
    const headingLevel = DataViewPrototypeGetInt32(records, byteOff + 12, true)
    let payload
    if (textLen !== 0) {
      // textOffset is relative to textPool's start; subarray is a
      // zero-copy view backed by the same ArrayBuffer.
      payload = sharedDecode.call(
        sharedDecoder,
        Uint8ArrayPrototypeSubarray(textPool, textOffset, textOffset + textLen),
      )
    } else if (headingLevel !== 0) {
      payload = headingLevel
    } else {
      payload = undefined
    }
    fn(code, payload)
  }
}

function parseTree(text, flags) {
  const events = parseMarkdown(text, flags || '')
  const root = { __proto__: null, type: 'doc', children: [] }
  const stack = [root]
  for (let i = 0, { length } = events; i < length; i += 1) {
    const [code, payload] = events[i]
    const cat = code & CATEGORY_MASK
    const val = code & VALUE_MASK
    if (cat === eventCategory.BLOCK_ENTER) {
      const node = {
        __proto__: null,
        kind: 'block',
        type: val,
        children: [],
      }
      if (val === blockType.H && typeof payload === 'number') {
        node.level = payload
      }
      ArrayPrototypePush(stack[stack.length - 1].children, node)
      stack.push(node)
    } else if (cat === eventCategory.BLOCK_LEAVE) {
      stack.pop()
    } else if (cat === eventCategory.SPAN_ENTER) {
      const node = {
        __proto__: null,
        kind: 'span',
        type: val,
        children: [],
      }
      ArrayPrototypePush(stack[stack.length - 1].children, node)
      stack.push(node)
    } else if (cat === eventCategory.SPAN_LEAVE) {
      stack.pop()
    } else if (cat === eventCategory.TEXT) {
      ArrayPrototypePush(stack[stack.length - 1].children, {
        __proto__: null,
        kind: 'text',
        type: val,
        text: payload || '',
      })
    }
  }
  return root
}

module.exports = ObjectFreeze({
  __proto__: null,
  blockType,
  decodeStream,
  eventCategory,
  parseMarkdown,
  parseMarkdownStream,
  parseTree,
  spanType,
  streamForEach,
  textType,
})

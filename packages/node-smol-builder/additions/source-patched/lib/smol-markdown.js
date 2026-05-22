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

const { ArrayPrototypePush, ObjectFreeze } = primordials

const { parseMarkdown } = internalBinding('smol_markdown')

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
  eventCategory,
  parseMarkdown,
  parseTree,
  spanType,
  textType,
})

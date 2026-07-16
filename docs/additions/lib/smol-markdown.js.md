# smol-markdown.js -- Public API for the Markdown parser (node:smol-markdown)

## What This File Does

This is the entry point for `require('node:smol-markdown')`. It exposes
a CommonMark + GFM Markdown parser backed by [md4c](https://github.com/mity/md4c)
(C99, ~3 KLOC, MIT). Replaces userland `marked` / `remark` /
`markdown-it` on the AI-output rendering hot path.

## How It Fits Together

```text
require('node:smol-markdown') -> this file (smol-markdown.js)
  -> internalBinding('smol_markdown') (C++ native binding)
    -> md4c (vendored at upstream/md4c, copied into
              src/socketsecurity/deps/markdown/upstream/{md4c.c,entity.c} at build)
```

The C++ binding lives at
`additions/source-patched/src/socketsecurity/deps/markdown/markdown_binding.cc`.
md4c is callback-driven (enter/leave block, enter/leave span, text).
The binding collects events into a flat C++ vector then materializes
them as a JS `Array<[code, payload]>` in one pass.

## Public API

```ts
import {
  parseMarkdown,
  parseTree,
  blockType,
  spanType,
  textType,
  eventCategory,
} from 'node:smol-markdown'

// parseMarkdown(text, flags?) -> flat event stream.
//
// Each event is [code, payload]:
//   code: (category << 12) | enum_value
//   payload: undefined | string (text/content) | number (heading level)
const events = parseMarkdown('# Hello **world**', 'github')

// parseTree(text, flags?) -> nested tree.
//
// Convenience wrapper that reconstructs an object graph from the
// event stream. Use parseMarkdown directly for hot paths.
const tree = parseTree('# Hello\n\n- a\n- b')
// {
//   type: 'doc',
//   children: [
//     { kind: 'block', type: blockType.H, level: 1, children: [
//       { kind: 'text', type: textType.NORMAL, text: 'Hello' }
//     ]},
//     { kind: 'block', type: blockType.UL, children: [
//       { kind: 'block', type: blockType.LI, children: [
//         { kind: 'block', type: blockType.P, children: [
//           { kind: 'text', type: textType.NORMAL, text: 'a' }
//         ]}
//       ]},
//       ...
//     ]}
//   ]
// }
```

### Event codes

```ts
eventCategory.BLOCK_ENTER  // 0x0000
eventCategory.BLOCK_LEAVE  // 0x1000
eventCategory.SPAN_ENTER   // 0x2000
eventCategory.SPAN_LEAVE   // 0x3000
eventCategory.TEXT         // 0x4000

// Low 12 bits hold one of:
blockType.DOC, blockType.QUOTE, blockType.UL, blockType.OL, blockType.LI,
blockType.HR, blockType.H, blockType.CODE, blockType.HTML, blockType.P,
blockType.TABLE, blockType.THEAD, blockType.TBODY, blockType.TR,
blockType.TH, blockType.TD

spanType.EM, spanType.STRONG, spanType.A, spanType.IMG, spanType.CODE,
spanType.DEL, spanType.LATEXMATH, spanType.LATEXMATH_DISPLAY,
spanType.WIKILINK, spanType.U

textType.NORMAL, textType.NULLCHAR, textType.ENTITY, textType.CODE,
textType.HTML, textType.LATEXMATH
```

### Flags

The second arg to `parseMarkdown` / `parseTree` is a comma-separated
list of dialect flags (case-insensitive):

| Token | md4c MD_FLAG_* |
| --- | --- |
| `collapse_whitespace` | COLLAPSEWHITESPACE |
| `permissive_atx_headers` | PERMISSIVEATXHEADERS |
| `permissive_url_autolinks` | PERMISSIVEURLAUTOLINKS |
| `permissive_email_autolinks` | PERMISSIVEEMAILAUTOLINKS |
| `permissive_www_autolinks` | PERMISSIVEWWWAUTOLINKS |
| `no_indented_code_blocks` | NOINDENTEDCODEBLOCKS |
| `no_html_blocks` | NOHTMLBLOCKS |
| `no_html_spans` | NOHTMLSPANS |
| `tables` | TABLES |
| `strikethrough` | STRIKETHROUGH |
| `tasklists` | TASKLISTS |
| `latex_math_spans` | LATEXMATHSPANS |
| `wikilinks` | WIKILINKS |
| `underline` | UNDERLINE |
| `hard_soft_breaks` | HARD_SOFT_BREAKS |
| `commonmark` | (empty set — strict CommonMark) |
| `github` | MD_DIALECT_GITHUB (tables + strikethrough + tasklists + autolinks) |

## Design Choices

**Flat event stream over JS object graph.** Building a V8 object per
node from C++ would be ~3-4 allocations per node (object, type, children
array, content). For a typical AI response (a few hundred nodes) that
is several hundred handles. The flat `[code, payload]` array is two
allocations per event (outer + inner array) and reconstructs to a tree
in JS in one linear pass — overall faster and gives the JS layer
freedom to either consume the stream directly (renderer hot path) or
materialize the tree (test/debugging tools).

**md4c chosen over markdown-it / cmark-gfm.** md4c is the smallest
spec-compliant C parser in the CommonMark Speed/Size matrix
(<https://github.com/mity/md4c#why-yet-another-markdown-parser-or-renderer>).
~3 KLOC total, no dependencies beyond libc, GFM extensions land via
flags rather than a separate fork.

## Where the Real Work Happens

The binding's design rationale is at the top of
`markdown_binding.cc`. Upstream md4c lives at
`packages/node-smol-builder/upstream/md4c/` (submodule, pinned in
`.config/lockstep.json`).

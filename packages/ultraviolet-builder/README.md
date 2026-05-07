# ultraviolet-builder

Native Node.js bindings for [Charmbracelet
Ultraviolet](https://github.com/charmbracelet/ultraviolet) — the
terminal I/O + decoder foundation used by Bubble Tea v2 and Lip Gloss
v2. Built via [napi-go](../napi-go).

## Status

**Phase 1 — Decoder only.** The binding currently exposes Ultraviolet's
`EventDecoder` to Node.js: bytes in, typed `Event[]` out. This gives
Node programs access to Ultraviolet's kitty keyboard protocol,
modifyOtherKeys, fixterms, bracketed-paste, SGR mouse, and
Win32-input-mode parsing — capabilities absent from OpenTUI.

Later phases will expand to `Screen`, `Buffer`, `Terminal`, and the
`layout` constraint solver as downstream consumers (stuie's bubbletea
port) require them.

## Consuming the binding

```ts
import { load } from 'ultraviolet-builder'

const uv = await load()                // loads lib/<platform-arch>/ultraviolet.node
const decoder = uv.newDecoder()
for (const ev of uv.decode(decoder, Buffer.from('\x1b[A'))) {
  // { type: 'KeyPress', code: ..., mod: ..., text: '' }
}
```

## Build

```
pnpm --filter ultraviolet-builder run build
pnpm --filter ultraviolet-builder run test
```

Requires Go >= 1.25 on `PATH`.

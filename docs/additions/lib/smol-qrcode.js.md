# smol-qrcode.js -- QR code encoder (node:smol-qrcode)

## What This File Does

This is the entry point for `require('node:smol-qrcode')`. It exposes
a QR code encoder backed by libqrencode v4.1.1 (C, vendored as a
submodule). Replaces the userland `qrcode` npm package.

## How It Fits Together

```
require('node:smol-qrcode') -> this file (smol-qrcode.js)
  -> internalBinding('smol_qrcode') (C++ binding)
    -> libqrencode (vendored at upstream/libqrencode, compiled
                    statically into the smol binary)
```

The C++ binding lives at
`additions/source-patched/src/socketsecurity/deps/qrcode/qrcode_binding.cc`.
libqrencode sources are copied from
`upstream/libqrencode/` into `additions/.../deps/qrcode/upstream/libqrencode/` at
build time. Only the library `.c` files are listed in node.gyp —
`qrenc.c` (the CLI tool with `main()`) is copied but not compiled.

## Public API

```ts
import { encode, ecLevel } from 'node:smol-qrcode'

// encode(text, ecLevel?) -> { width, matrix }
const { width, matrix } = encode('https://example.com', ecLevel.M)
// width: side length in cells (e.g. 21 for version-1, 25 for version-2, ...)
// matrix: Uint8Array of length width*width
//   each byte's bit 0 = "is black cell" (1) | "is white cell" (0)
//   higher bits are libqrencode's internal state; mask with `& 1`

for (let y = 0; y < width; y++) {
  for (let x = 0; x < width; x++) {
    const black = matrix[y * width + x] & 1
    // render cell at (x, y)...
  }
}
```

### EC levels

```ts
ecLevel.L // 0 — ~7% error recovery
ecLevel.M // 1 — ~15% (default)
ecLevel.Q // 2 — ~25%
ecLevel.H // 3 — ~30%
```

## Design Choices

**libqrencode chosen over a 1:1 port of opentui's TS encoder.** The
TS source (`packages/qrcode/src/lib/qrcode.ts`, 1250 lines) plus the
Shift-JIS data table (6947 lines, both upstream) is ~8.2 KLOC to
maintain in C++. libqrencode is the canonical C QR encoder, 6 KLOC,
maintained for 20+ years, LGPL-2.1 with explicit static-link allowance.
We vendor + statically link; the binding glue is ~100 lines.

**8-bit-mode encoding only.** Pass any UTF-8 string as bytes;
libqrencode's `QRcode_encodeString8bit` handles version selection
automatically (picks the smallest QR version that fits). For
alphanumeric mode or kanji mode, a future API addition would expose
`QRcode_encodeString` with the mode hint; the current shape covers
~95% of TUI QR-code use cases (URLs, payment intents, configs).

**JS owns the matrix buffer.** The binding allocates a V8 ArrayBuffer

- Uint8Array of `width*width` bytes, memcpys libqrencode's output
  into it, then frees the libqrencode QRcode struct. No per-cell
  crossings; JS-side render loops can iterate the matrix directly with
  typed-array access (~1 cycle per cell).

**No FastApi.** encode() is called once per QR code (not per frame).
The slow-path dispatch cost is dwarfed by the encoder's actual work
(~milliseconds for a moderate-size input).

## Where the Real Work Happens

libqrencode upstream: <https://github.com/fukuchi/libqrencode>

The core encoder pipeline lives in:

- `qrinput.c`: input encoding + segment splitting
- `qrencode.c`: Reed-Solomon error correction + matrix layout
- `mask.c`: mask pattern selection (the 8 standard QR masks)
- `qrspec.c`: per-version metadata tables

Pinned in `.config/lockstep.json` as the `libqrencode` version-pin
row at SHA 715e29f (v4.1.1).

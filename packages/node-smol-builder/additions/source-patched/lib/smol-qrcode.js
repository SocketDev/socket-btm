'use strict'

// node:smol-qrcode — QR code encoder backed by libqrencode v4.1.1
// (vendored at upstream/libqrencode). Replaces the userland `qrcode`
// npm package on the AI-output rendering path (QR codes for sharing
// URLs, payment intents, etc.).
//
// Surface:
//
//   encode(text, ecLevel?) -> { width, matrix }
//     text:    string to encode (UTF-8, 8-bit mode — libqrencode
//              auto-detects the right QR version).
//     ecLevel: 0=L (~7% recovery), 1=M (~15%, default), 2=Q (~25%),
//              3=H (~30%).
//     Returns { width: side-length-in-cells, matrix: Uint8Array of
//     width*width bytes }. Each byte's bit 0 indicates whether the
//     cell is black (1) or white (0). Mask with `& 1` to ignore
//     libqrencode's internal state bits.
//
// Render to terminal (typical usage):
//
//   const { encode } = require('node:smol-qrcode')
//   const { rendererSet } = require('node:smol-tui')
//   const { width, matrix } = encode('https://example.com')
//   for (let y = 0; y < width; y++) {
//     for (let x = 0; x < width; x++) {
//       const black = matrix[y * width + x] & 1
//       rendererSet(renderer, x, y,
//         black ? 0x2588 /* ▍ */ : 0x20,
//         255, 255, 255, 0, 0, 0, 0)
//     }
//   }

const { ObjectFreeze } = primordials

const { encode } = internalBinding('smol_qrcode')

const ecLevel = ObjectFreeze({
  __proto__: null,
  L: 0,  // ~7% recovery
  M: 1,  // ~15% recovery (default)
  Q: 2,  // ~25% recovery
  H: 3,  // ~30% recovery
})

module.exports = ObjectFreeze({
  __proto__: null,
  ecLevel,
  encode,
})

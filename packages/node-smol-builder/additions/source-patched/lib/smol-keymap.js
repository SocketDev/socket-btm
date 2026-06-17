'use strict'

// node:smol-keymap — keymap matcher backed by a native chord state
// machine. Replaces the @opentui/keymap matcher hot path (~5 ns per
// keystroke vs ~50-100 ns in TS). Layers, extension contexts, command
// catalogs etc. stay in userland TS.
//
// Surface:
//
//   createKeymap(rulesJson) -> handle | 0
//     Parses a JSON rules object:
//       { "ctrl+a": "select-all",
//         "ctrl+x ctrl+s": "save",
//         "esc": "cancel" }
//     Returns 0 on parse failure. Modifier names are case-insensitive
//     and accept common aliases: ctrl/control, shift, alt/option/opt,
//     meta/cmd/command/super/win. Modifier order doesn't matter
//     (`shift+ctrl+a` === `ctrl+shift+a`).
//
//   destroyKeymap(handle): release.
//
//   matchKey(handle, keyName, modifierBits) -> command string | null
//     modifierBits: bit 0 ctrl, bit 1 shift, bit 2 alt, bit 3 meta.
//     Returns the bound command on a complete match. Returns null
//     when no binding matches OR when a multi-step chord is mid-way
//     (call again with the next keystroke to advance). Use
//     `getModifierBits` to compute the bits portably from a JS key
//     event.
//
//   resetChord(handle): clear pending chord state (e.g. after a
//   timeout). Useful for emacs-style chord timeouts in JS.
//
//   getModifierBits({ ctrl, shift, alt, meta }) -> integer
//     Convenience helper. Builds the bit-pack from boolean modifier
//     flags as they typically appear in key-event objects.

const { ObjectFreeze } = primordials

const { createKeymap, destroyKeymap, matchKey, resetChord } =
  internalBinding('smol_keymap')

const MOD_CTRL = 1 << 0
const MOD_SHIFT = 1 << 1
const MOD_ALT = 1 << 2
const MOD_META = 1 << 3

function getModifierBits(mods) {
  if (!mods) {
    return 0
  }
  let bits = 0
  if (mods.ctrl) {
    bits |= MOD_CTRL
  }
  if (mods.shift) {
    bits |= MOD_SHIFT
  }
  if (mods.alt) {
    bits |= MOD_ALT
  }
  if (mods.meta) {
    bits |= MOD_META
  }
  return bits
}

const modifier = ObjectFreeze({
  __proto__: null,
  CTRL: MOD_CTRL,
  SHIFT: MOD_SHIFT,
  ALT: MOD_ALT,
  META: MOD_META,
})

module.exports = ObjectFreeze({
  __proto__: null,
  createKeymap,
  destroyKeymap,
  getModifierBits,
  matchKey,
  modifier,
  resetChord,
})

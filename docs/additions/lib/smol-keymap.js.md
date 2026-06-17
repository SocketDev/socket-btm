# smol-keymap.js -- Public API for the keymap matcher (node:smol-keymap)

## What This File Does

This is the entry point for `require('node:smol-keymap')`. It exposes
a chord-aware keymap matcher backed by a C++ state machine.

Replaces the @opentui/keymap matcher hot path. The full keymap engine
(layers, extension contexts, command catalog, runtime emitter,
activation service) stays in userland TS; only the per-keystroke
match runs through this binding.

## How It Fits Together

```
require('node:smol-keymap') -> this file (smol-keymap.js)
  -> internalBinding('smol_keymap') (C++ native binding)
```

The C++ binding lives at
`additions/source-patched/src/socketsecurity/keymap/keymap_binding.cc`.
Bindings are parsed once into a canonical `ctrl+shift+alt+meta+<key>`
match string per chord step; matchKey() builds the canonical key for
the input keystroke and does a string compare against the candidate
bindings (filtered by current chord position).

## Public API

```ts
import {
  createKeymap,
  destroyKeymap,
  matchKey,
  resetChord,
  modifier,
  getModifierBits,
} from 'node:smol-keymap'

// Parse rules JSON. Returns handle (>0) on success, 0 on parse error.
const km = createKeymap(
  JSON.stringify({
    'ctrl+a': 'select-all',
    'ctrl+x ctrl+s': 'save',
    'ctrl+x ctrl+c': 'exit',
    esc: 'cancel',
  }),
)

// Match keystroke. Returns command string on a complete match, null
// otherwise. Mid-chord steps (e.g. just `ctrl+x` of a `ctrl+x ctrl+s`
// chord) return null — keep calling on subsequent keystrokes.
matchKey(km, 'a', modifier.CTRL) // 'select-all'
matchKey(km, 'x', modifier.CTRL) // null (chord in progress)
matchKey(km, 's', modifier.CTRL) // 'save' (chord complete)

// Build modifier bits from an event-like object.
const bits = getModifierBits({ ctrl: true, shift: false }) // 1

// Reset pending chord state (e.g. after a timeout).
resetChord(km)

// Release.
destroyKeymap(km)
```

### Modifier bits

```ts
modifier.CTRL // 1 << 0
modifier.SHIFT // 1 << 1
modifier.ALT // 1 << 2
modifier.META // 1 << 3
```

### Rules format

Each rule is `"<chord> [<chord> ...]"` → `"<command>"`. A chord is one
or more modifiers + a key, joined with `+`:

```
"ctrl+a"           // ctrl-a
"ctrl+shift+a"     // ctrl-shift-a (any modifier order works)
"esc"              // bare key
"ctrl+x ctrl+s"    // two-step chord (emacs-style)
"a b c"            // three-step plain chord
```

Modifier name aliases (case-insensitive):

- `ctrl` | `control` | `c`
- `shift` | `s`
- `alt` | `option` | `opt`
- `meta` | `cmd` | `command` | `super` | `win`

## Design Choices

**Canonical match keys at parse time.** Each chord step is normalized
to `ctrl+shift+alt+meta+<key>` (all four modifiers in fixed order,
all lowercase) when the keymap is created. matchKey() composes the
same canonical form for the input keystroke and does a string compare
against candidates. No regex, no dispatch table walking.

**Process-wide handle registry.** Same shape as the mouse parser /
renderer / yoga bindings in tui_binding.cc. JS holds an opaque
uint32_t handle; the C++ side owns the Keymap struct + its pending-
chord state. One mutex per registry; no contention because keymaps
are per-app-instance, not per-call.

**Permissive JSON parser inside the binding.** The rules string is
typically small (<10 KB) and parsed once at keymap creation. Inlining
a small JSON parser avoids a JS-side `JSON.parse` round trip on
binding startup. Format support: top-level object with string keys
and string values, `\"` and `\\` escapes.

**No FastApi yet.** matchKey returns a string (or null) which V8 Fast
API doesn't accept cleanly. The slow-path dispatch cost (~50 ns) is
still well under the time-budget for a keystroke event. If profiling
ever shows it dominates, a uint32-encoded-command-index variant could
move to Fast API.

## Where the Real Work Happens

Hot path in `keymap_binding.cc`'s `MatchKey`:

- BuildMatchKey: ~20-byte string append (no allocation for keys
  shorter than std::string's SSO buffer, which is 15-22 bytes on
  current libc++/libstdc++).
- Candidate scan: linear walk over `pending_indices` (typically 1-5
  entries when mid-chord; up to `bindings.size()` on first keystroke).
- String compare per candidate: `std::string::operator==` calls
  memcmp internally.

Total per-keystroke time: ~5-50 ns depending on chord depth and
binding count. For comparison, the TS matcher is ~100-500 ns.

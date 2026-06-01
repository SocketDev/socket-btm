/**
 * @fileoverview Authoritative registry of node-smol optional subsystems.
 *
 * Single source of truth shared by:
 *   - the bundle feature detector (scripts/detect-bundle-features.mts) — which
 *     `signals` prove a feature is used, so an unused one can be dropped;
 *   - the flag mapper — `configureFlagWhenDropped` is the exact ./configure arg
 *     to emit when a feature is dropped;
 *   - the gyp gating (patches 004 + 018) — `gypVar` is the node_use_* variable
 *     each subsystem's sources are gated on;
 *   - the flaggable test harness — `name` keys the `has(feature)` skip predicate.
 *
 * Adding a subsystem? Add one entry here, wire its `gypVar` in patch 004, its
 * configure flag in patch 018, and a skipIf in its test. The
 * project_additions_vs_patch_sync invariant means sources and gyp must stay in
 * lockstep — this registry is the checklist.
 */

/**
 * Drop policy:
 *   'auto'        — droppable purely from static evidence (no signals ⇒ drop).
 *   'soft'        — usable behind an isBuiltin() guard with a runtime fallback;
 *                   droppable, but the gate must verify the fallback path.
 *   'keep-unless-explicit' — never auto-dropped (deep coupling / broad blast
 *                   radius); only an explicit override in the bundle's
 *                   package.json `smol.drop` list removes it.
 *   'always'      — core runtime; never gated, never dropped (listed for the
 *                   test harness + documentation, has no flag).
 */
export type DropPolicy =
  | 'auto'
  | 'soft'
  | 'keep-unless-explicit'
  | 'always'

export type SmolFeature = {
  __proto__: null
  /** Stable key — used by has(feature) in tests and the manifest. */
  name: string
  /** Human summary for reports. */
  description: string
  /**
   * String literals whose presence in the bundle proves the feature is used.
   * Matched as substrings against raw (possibly-minified) source — these are
   * module specifiers / well-known strings that survive minification because
   * they are passed to require()/import()/isBuiltin() as string arguments.
   */
  stringSignals: string[]
  /**
   * Global member-access signals detected via AST (e.g. `Temporal.Now`,
   * `navigator.gpu`). `object` is the root identifier, `property` an optional
   * member; a bare `object` with no `property` matches any access. These catch
   * usage that has no string specifier.
   */
  memberSignals: { object: string; property?: string }[]
  /**
   * The exact ./configure argument to emit when this feature is dropped.
   * `null` for 'always' features (no flag). For features gated by an opt-IN
   * flag (postgres/iouring/dawn), dropping = omitting the flag, so this is null
   * and `optInFlag` carries the enable flag instead.
   */
  configureFlagWhenDropped: string | null
  /** For opt-in features: the flag that ENABLES them (default off). */
  optInFlag: string | null
  /** The node_use_* gyp variable gating this feature's sources in node.gyp. */
  gypVar: string | null
  /** Drop policy — see DropPolicy. */
  policy: DropPolicy
  /** Rough binary-size delta (MB) recovered by dropping, for report sorting. */
  approxBinaryMb: number
}

function feature(f: Omit<SmolFeature, '__proto__'>): SmolFeature {
  return { __proto__: null, ...f }
}

/**
 * Every optional node-smol subsystem. `always` core (vfs/util/primordial/simd/
 * webstreams/manifest) is listed so the test harness and docs see the full
 * surface, but those carry no flag and are never dropped.
 */
export const SMOL_FEATURES: readonly SmolFeature[] = [
  feature({
    name: 'quic',
    description: 'QUIC + HTTP/3 transport (lsquic + ls-qpack)',
    stringSignals: ['node:smol-quic', 'smol-quic'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-quic',
    optInFlag: null,
    gypVar: 'node_use_smol_quic',
    policy: 'auto',
    approxBinaryMb: 9,
  }),
  feature({
    name: 'http3',
    description: 'HTTP/3 binding glue (depends on quic)',
    stringSignals: ['node:smol-http3', 'smol-http3'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-http3',
    optInFlag: null,
    gypVar: 'node_use_smol_http3',
    policy: 'auto',
    approxBinaryMb: 0.2,
  }),
  feature({
    name: 'smolHttp',
    description: 'uWebSockets HTTP server (node:smol-http)',
    stringSignals: ['node:smol-http', 'smol-http'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-http',
    optInFlag: null,
    gypVar: 'node_use_smol_http',
    policy: 'auto',
    approxBinaryMb: 1.5,
  }),
  feature({
    name: 'sqlite',
    description: 'node:sqlite (upstream Node built-in)',
    // node:sqlite is the canonical specifier; node:smol-sqlite is a future
    // alias kept here defensively.
    stringSignals: ['node:sqlite', 'node:smol-sqlite'],
    memberSignals: [],
    // Upstream Node already ships --without-sqlite + node_use_sqlite — no patch
    // work needed, the detector just emits the existing flag.
    configureFlagWhenDropped: '--without-sqlite',
    optInFlag: null,
    gypVar: 'node_use_sqlite',
    policy: 'auto',
    approxBinaryMb: 1.5,
  }),
  feature({
    name: 'postgres',
    description: 'PostgreSQL client (libpq)',
    stringSignals: ['node:smol-postgres', 'smol-postgres'],
    memberSignals: [],
    // Opt-in: dropping = not passing --with-postgres. Already off by default.
    configureFlagWhenDropped: null,
    optInFlag: '--with-postgres',
    gypVar: 'node_use_postgres',
    policy: 'auto',
    approxBinaryMb: 3,
  }),
  feature({
    name: 'webgpu',
    description: 'WebGPU / Dawn (navigator.gpu)',
    stringSignals: ['node:smol-webgpu', 'smol-webgpu'],
    memberSignals: [{ object: 'navigator', property: 'gpu' }],
    configureFlagWhenDropped: null,
    optInFlag: '--with-dawn',
    gypVar: 'node_use_dawn',
    policy: 'auto',
    approxBinaryMb: 8,
  }),
  feature({
    name: 'tui',
    description: 'Terminal UI + Yoga layout (node:smol-tui)',
    stringSignals: ['node:smol-tui', 'smol-tui'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-tui',
    optInFlag: null,
    gypVar: 'node_use_smol_tui',
    policy: 'auto',
    approxBinaryMb: 2,
  }),
  feature({
    name: 'keymap',
    description: 'Keymap chord matcher (node:smol-keymap, TUI input)',
    stringSignals: ['node:smol-keymap', 'smol-keymap'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-keymap',
    optInFlag: null,
    gypVar: 'node_use_smol_keymap',
    policy: 'auto',
    approxBinaryMb: 0.1,
  }),
  feature({
    name: 'ffi',
    description: 'Foreign Function Interface (node:smol-ffi)',
    stringSignals: ['node:smol-ffi', 'smol-ffi'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-ffi',
    optInFlag: null,
    gypVar: 'node_use_smol_ffi',
    policy: 'auto',
    approxBinaryMb: 0.5,
  }),
  feature({
    name: 'ilp',
    description: 'InfluxDB Line Protocol client (node:smol-ilp)',
    stringSignals: ['node:smol-ilp', 'smol-ilp'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-ilp',
    optInFlag: null,
    gypVar: 'node_use_smol_ilp',
    policy: 'auto',
    approxBinaryMb: 0.1,
  }),
  feature({
    name: 'treeSitter',
    description: 'tree-sitter parser (node:smol-tree-sitter)',
    stringSignals: ['node:smol-tree-sitter', 'smol-tree-sitter'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-treesitter',
    optInFlag: null,
    gypVar: 'node_use_smol_treesitter',
    policy: 'auto',
    approxBinaryMb: 2,
  }),
  feature({
    name: 'qrcode',
    description: 'QR code generation (node:smol-qrcode)',
    stringSignals: ['node:smol-qrcode', 'smol-qrcode'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-qrcode',
    optInFlag: null,
    gypVar: 'node_use_smol_qrcode',
    policy: 'auto',
    approxBinaryMb: 0.8,
  }),
  feature({
    name: 'markdown',
    description: 'CommonMark/GFM parser (node:smol-markdown via md4c)',
    // MUST be the specifier — bare "markdown" is a false positive (apps have
    // their own JS markdown utilities). The detector only matches these strings.
    stringSignals: ['node:smol-markdown', 'smol-markdown'],
    memberSignals: [],
    configureFlagWhenDropped: '--without-smol-markdown',
    optInFlag: null,
    gypVar: 'node_use_smol_markdown',
    policy: 'auto',
    approxBinaryMb: 0.4,
  }),
  feature({
    name: 'power',
    description: 'Power-source detection (node:smol-power)',
    stringSignals: ['node:smol-power', 'smol-power'],
    memberSignals: [],
    // NOT gated: power glue (power_binding.cc) plus the per-OS impls
    // (power_mac/linux/win.cc) + an IOKit framework link are split across 4 gyp
    // blocks for ~0.05MB — not worth a gate. It stays always-on (harmless), so
    // the detector emits no flag for it. socket-cli probes it behind isBuiltin()
    // with a shellout fallback regardless.
    configureFlagWhenDropped: null,
    optInFlag: null,
    gypVar: null,
    policy: 'always',
    approxBinaryMb: 0.05,
  }),
  feature({
    name: 'temporal',
    description: 'ECMAScript Temporal (C++ port, ICU-coupled)',
    stringSignals: ['@js-temporal', 'temporal-polyfill'],
    memberSignals: [{ object: 'Temporal' }],
    // Dropping Temporal means dropping --v8-enable-temporal-support and
    // unwiring patches 004/021 — high blast radius, ICU + V8 + mksnapshot
    // coupling. Never auto-dropped.
    configureFlagWhenDropped: null,
    optInFlag: null,
    gypVar: 'node_use_smol_temporal',
    policy: 'keep-unless-explicit',
    approxBinaryMb: 2.5,
  }),
  feature({
    name: 'intl',
    description: 'Intl / ICU (locale formatting)',
    // Intl is a GLOBAL, not an importable module — detect via the `Intl.`
    // member and `toLocale*(` usage, never a `node:intl` specifier (which isn't
    // a real builtin). This keeps featureBuiltinSpecifier('intl') === undefined
    // so the gate doesn't probe a non-existent module.
    stringSignals: ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'],
    memberSignals: [{ object: 'Intl' }],
    // small-icu → none saves ~8MB but breaks all locale formatting + collation
    // and Temporal's calendar backend. Never auto-dropped.
    configureFlagWhenDropped: '--with-intl=none',
    optInFlag: null,
    gypVar: null,
    policy: 'keep-unless-explicit',
    approxBinaryMb: 8,
  }),
] as const

/** Features that can be auto-dropped from static evidence alone. */
export function autoDroppableFeatures(): SmolFeature[] {
  return SMOL_FEATURES.filter(
    f => f.policy === 'auto' || f.policy === 'soft',
  )
}

/** Look up a feature by name. */
export function getFeature(name: string): SmolFeature | undefined {
  return SMOL_FEATURES.find(f => f.name === name)
}

/**
 * The canonical `node:`-prefixed builtin specifier for a feature (the first
 * `node:` string signal), or undefined for features with no importable module
 * (e.g. `intl`, `temporal` — reached via globals, not a `node:` import). Used by
 * the test harness to map a feature name to its `isBuiltin('node:…')` probe.
 */
export function featureBuiltinSpecifier(name: string): string | undefined {
  const f = getFeature(name)
  return f?.stringSignals.find(s => s.startsWith('node:'))
}

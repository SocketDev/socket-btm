# lsquic-infra

Source-only lsquic + ls-qpack package, vendored as the QUIC engine for
node-smol's `node:smol-quic` and `node:smol-http3` builtins. Mirrors
the [`temporal-infra`](../temporal-infra/) pattern — no binary release,
no Docker, no workflow. Consumers compile the upstream `.c` / `.h`
files inline via `additions/source-patched`.

## Status

**v0 scaffold.** Submodules + paths defined. node.gyp wiring +
configure.py 3-flag plumbing lands as part of the same task (#334).

## Why not ngtcp2 + nghttp3 (upstream Node's choice)

Upstream Node 26 vendors `deps/ngtcp2/` + `deps/nghttp3/` and ships an
experimental `node:quic` module gated behind `--experimental-quic`.
We side with bun on the engine choice — lsquic powers bun's 283k
req/s fetch-handler HTTP/3 benchmark. Upstream's QUIC files stay on
disk in the patched source tree but are excluded from the build via
the `use_node_quic` configure flag (default `false`).

## Why not BoringSSL (lsquic's default TLS backend)

lsquic upstream's README documents BoringSSL as the TLS backend. We
deviate: node-smol's vendored OpenSSL 3.5.6 exposes the QUIC
handshake API (`SSL_set_quic_tls_cbs` — verified in
`packages/node-smol-builder/upstream/node/deps/openssl/openssl/include/openssl/ssl.h.in`).
lsquic v4.6.2's cmake auto-detects this via
`LSQUIC_LIBSSL=OPENSSL`. We save ~30k LOC of BoringSSL vendoring and
~40 CPU-min of CI build time by linking against the OpenSSL Node
already ships.

## Three configure flags

| Flag             | Default | Gates                                                                            |
| ---------------- | ------- | -------------------------------------------------------------------------------- |
| `use_node_quic`  | `false` | Upstream's `src/quic/*.cc`, `deps/ngtcp2/`, `deps/nghttp3/`, `node:quic` builtin |
| `use_smol_quic`  | `true`  | This package's lsquic + ls-qpack sources + `node:smol-quic` builtin              |
| `use_smol_http3` | `true`  | http3 binding glue + `node:smol-http3` builtin                                   |

Implication rules:

- `use_smol_http3=true` ⇒ forces `use_smol_quic=true` (configure error on conflict).
- `use_smol_quic=false` ⇒ auto-disables `use_smol_http3`.
- `--without-ssl` forces all three off.
- `use_node_quic` is independent — can coexist with smol stack (two QUIC builtins side-by-side, useful for migration / A/B perf comparison).

## Vendor plan

| Submodule           | Pin                                                                  | Match         |
| ------------------- | -------------------------------------------------------------------- | ------------- |
| `upstream/lsquic`   | v4.6.2 — SHA `3181911301b1aa4f54c1ed690901abc674ee08fb` (2026-04-20) | bun PR #29768 |
| `upstream/ls-qpack` | v2.6.2 — SHA `1e9c5b8e59f8161c54f168a570c8bfdc59ded0c3` (2025-06-16) | bun PR #29768 |

All SHAs verified against bun's HTTP/3 PR (`oven-sh/bun#29768` @
`3addffd8c…`) so we inherit a known-working combination.

## Custom patches

Three bun patches mirrored verbatim from `oven-sh/bun#29768`
(`packages/lsquic-infra/patches/lsquic/`):

| Patch                      | Purpose                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `versions-to-string.patch` | Ship pre-generated `lsquic_versions_to_string.c` so CI doesn't need Perl (lsquic's normal build generates it via `gen-verstrs.pl`).          |
| `allow-no-sni.patch`       | Allow HTTP/3 connections without SNI in `lsquic_enc_sess_ietf.c` (e.g. IP-literal connections). Removes the spec-strict early-return.        |
| `skip-priority-walk.patch` | Adds `CP_HAVE_PRIO` flag — short-circuits `find_lowest_prio` hash-table walk on the send-control hot path for the common single-stream case. |

## Lockstep

Rows planned for socket-btm's `.config/lockstep.json`:

| ID               | Kind          | Upstream                                                | Local                    |
| ---------------- | ------------- | ------------------------------------------------------- | ------------------------ |
| `lsquic`         | `version-pin` | `litespeedtech/lsquic` v4.6.2 (matches bun PR #29768)   | `upstream/lsquic/`       |
| `ls-qpack`       | `version-pin` | `litespeedtech/ls-qpack` v2.6.2 (matches bun PR #29768) | `upstream/ls-qpack/`     |
| `lsquic-patches` | `file-fork`   | bun PR #29768 `packages/bun-uws/patches/lsquic/*.patch` | `patches/lsquic/*.patch` |

## Wiring into node-smol

`node-smol-builder/scripts/binary-released/shared/prepare-external-sources.mts`
gets two `MONOREPO_PACKAGE_SOURCES` entries (mirrors temporal-infra's
wiring):

```ts
{
  from: path.join(LSQUIC_INFRA_DIR, 'upstream', 'lsquic'),
  to:   path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'lsquic'),
},
{
  from: path.join(LSQUIC_INFRA_DIR, 'upstream', 'ls-qpack'),
  to:   path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'ls-qpack'),
},
```

The 3 patches in `patches/lsquic/` apply against the copied lsquic
source via `apply-patches.mts`.

## node.gyp source-list (under `use_smol_quic` condition)

```python
['node_use_smol_quic=="true"', {
  'sources': [
    # lsquic engine + transport
    'deps/lsquic/src/liblsquic/*.c',
    # lsqpack header compression (sibling deps tree)
    'deps/ls-qpack/lsqpack.c',
    # our binding glue (lands via tui-infra-style additions)
    'src/socketsecurity/quic/quic_binding.cc',
    'src/socketsecurity/quic/quic_engine_wrap.cc',
    'src/socketsecurity/quic/quic_session_wrap.cc',
    'src/socketsecurity/quic/quic_stream_wrap.cc',
  ],
  'include_dirs': [
    'deps/lsquic/include',
    'deps/lsquic/src/liblsquic',
    'deps/ls-qpack',
  ],
  'defines': [
    'HAVE_OPENSSL=1',
    'LSQUIC_QUIC_TLS_LIB=OPENSSL',
    'LSQUIC_DEBUG_NEXT_ADV_TICK=0',
    'LSQUIC_CONN_STATS=0',
    'LSQUIC_QIR=0',
  ],
}],
```

The four `LSQUIC_*=0` defines match bun's PR `scripts/build/deps/
lsquic.ts` defines list.

## Forward edges

- Tier 2 (WebTransport): flip `LSQUIC_WEBTRANSPORT` from OFF to ON in
  the gyp defines. Filed as task #329-equivalent for QUIC stack.
- Future: if benchmarks show ngtcp2 keeps pace with lsquic on
  workloads we care about, revisit by flipping default to
  `use_node_quic=true` and dropping the lsquic stack — but that's a
  larger architecture change.

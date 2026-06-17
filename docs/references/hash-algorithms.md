# Hash algorithms — which digest, where, and why (socket-btm)

socket-btm uses three hash algorithms across its C/C++ runtime and its TypeScript
build infra. The rule is the same as the socket-lib side:

> **SHA-512 is the trust boundary. SHA-256 is the interop/checksum shape (and the npm-cacache format). Truncated hashes are addressing, never trust. SHA-1 appears only where an external format (npm cacache index lines) mandates it.**

Before flipping any digest below, read "Why a flip isn't free" — several of these
are format-compat, not security choices, and changing them breaks readers for zero
gain.

## Subsystem map

### 1. SEA stub footer integrity — SHA-512 (load-bearing)

The footer hash verifies the compressed stub payload at load time; a mismatch
aborts (tamper detection). The footer field is **64 bytes** (`INTEGRITY_HASH_LEN`).

- Compute / verify: `packages/bin-infra/src/socketsecurity/bin-infra/smol_segment.c`
  — `smol_compute_sha512()` (line ~41), `smol_verify_integrity()` (line ~84,
  64-byte `memcmp`).
- Per-platform verify call sites: `packages/stubs-builder/src/socketsecurity/stubs-builder/{macho,elf,pe}_stub.c`
  (`smol_verify_integrity(...)`).
- SRI string for decompressed data: `dlx_calculate_integrity()` →
  `sha512-<base64>` in `packages/build-infra/src/socketsecurity/build-infra/dlx_cache_common.h`.

Footer layout: `[marker][8B compressed_size][8B uncompressed_size][16B cache_key]
[3B platform_metadata][64B integrity_hash = SHA-512]`.

### 2. socket_cacache.h — three digests, three jobs

`packages/build-infra/src/socketsecurity/build-infra/socket_cacache.h` implements
the **npm cacache on-disk format (index-v5, content-v2)**. That format dictates two
of the three:

| digest      | site                                                                           | role                                                                  | trust?                      |
| ----------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------------- |
| **SHA-512** | `scache_sha512` (~390), content verify on `cacache_get` (~877, 64-byte memcmp) | content integrity                                                     | **YES**                     |
| **SHA-256** | `scache_sha256` (~354), index path (~551-563)                                  | index-v5 key→bucket path `index-v5/{sha256(key)[0:2]}/{[2:4]}/{[4:]}` | no — addressing, npm-format |
| **SHA-1**   | `scache_sha1` (~318), index-line verify (~713, memcmp ~719)                    | per-line index integrity (npm cacache's index-line hash)              | no — npm-format identity    |

The sha256/sha1 here are **the npm cacache format**, not Socket choices. Content
integrity (the security boundary) is already SHA-512. See
`.claude/reports/cacache-structural-hash-investigation.md` for why the structural
sha256/sha1 must stay (flipping = format break, zero gain).

### 3. Build cache keys — SHA-512, untruncated (NOT trust)

- `packages/build-infra/lib/cache-key.mts` — `createHash('sha512')` over source
  file contents to key build artifacts. Invalidation only; never verified as
  integrity. SHA-512 here is "OUR-side default", not a security requirement.

### 4. Checkpoint / config fingerprints — truncated SHA-256 (NOT trust)

- `packages/build-infra/lib/checkpoint-cache-key.mts:89` and
  `checkpoint-manager.mts` (~593, ~1387) — `createHash('sha256').…slice(0, 8)`:
  a 4-byte config fingerprint for cache busting. Truncation is fine — addressing.

### 5. Release-artifact checksums — SHA-256 hex (load-bearing, interop SHAPE)

- `packages/build-infra/lib/release-checksums/{core,producer}.mts` — emit
  `<sha256-hex> <filename>` (GNU `sha256sum` format) for published releases.
  SHA-256 because that is the shape consumers verify with; integrity of the
  binary itself is the SEA footer (sha512).

### 6. Prebuilt / external-tool download verify — SHA-256 hex + SRI (load-bearing)

- `packages/build-infra/lib/tool-downloader.mts` (`computeFileSha256`, mismatch
  check ~172) and `vfs-tools-downloader.mts` (~217-315) — verify a downloaded
  prebuilt against an expected SHA-256.
- `external-tools-schema.mts` — SRI: `sha256-<base64>` for assets,
  `sha512-<base64>` for npm packages (mirrors the socket-lib integrity/checksum
  split).

### 7. `.gitmodules` submodule pins — SHA-256 hex (structural / GitHub-format)

- `scripts/fleet/gen-gitmodules-hash.mts:157` — `sha256(codeload tarball)`;
  parsed by `scripts/check-version-consistency.mts`. Format:
  `# <package>-X.Y.Z sha256:<64hex>`. Mirrors GitHub's archive hash — a shape, not
  a Socket trust choice.

## Why a flip isn't free

- **The cacache index-v5 sha256 + index-line sha1 are the npm format.** Flipping
  them makes the cache unreadable by any index-v5 reader and orphans the existing
  `~/.socket/_cacache` — for zero security gain (content integrity is already
  sha512). They are addressing/identity, not trust gates.
- **Release + download checksums are sha256 because consumers speak sha256**
  (`sha256sum`, GitHub `SHA256SUMS`). The artifact's own integrity is the SEA
  footer (sha512); the checksum is the interop shape.
- **The SEA footer is sha512 and the field is 64 bytes.** A prebuilt stub built
  before the sha256→sha512 footer change embeds a 32-byte hash that cannot verify
  against the 64-byte footer reader — every platform stub must be rebuilt +
  republished together (the footer-migration release-coordination step).
- **Cache keys (build + checkpoint) are addressing** — truncation is fine, and
  flipping the algorithm only invalidates the cache once.

See also: socket-lib `docs/hash-algorithms.md` for the TypeScript/runtime side
(integrity vs checksum flavors, dlx cache keys) — same rule.

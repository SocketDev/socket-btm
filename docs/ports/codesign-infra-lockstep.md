# codesign-infra lockstep tracker

## The contract

**Observable 1:1 with Apple code signing.** A Mach-O signed by codesign-infra
verifies under Apple's own `codesign -v` (ad-hoc and Developer-ID), and loads via
`dlopen`. That end-to-end oracle — `codesign -v` + `dlopen` + a structural diff
against an apple-codesign-/`codesign`-produced reference — is the contract, not
byte-for-byte equality with the upstream Rust crate's internals.

**Not a goal:** the upstream crate's full ~30K-line surface. We port only the
Mach-O _signing_ core; notarization, remote/cloud signing, YubiKey/PKCS#11,
DMG/bundle signing, and the CLI are out of scope. ELF/PE need no signature.

## How to keep this lockstep

1. **Apple's `codesign -v` is the contract.** Every produced signature must verify
   under it. The unit + integration tests gate on it (macOS-only; on Linux/Windows
   hosts the structural assertions run, `codesign -v` is skipped).
2. **apple-codesign (indygreg/apple-platform-rs, `apple-codesign` subpath) is the
   implementation reference.** When porting a routine, cite the upstream Rust
   `file:line` in a comment so cascades have a fixed point. Pin in
   [`xport.json`](../../xport.json) (`feature-parity`, manual audits — never
   auto-cascade a semantic re-implementation).
3. **BoringSSL owns all cryptography.** SHA-256, RSA, ECDSA P-256, X.509,
   PKCS#7/CMS come from `boringssl-builder` (libcrypto). The port never hand-rolls
   a hash or a signature primitive — only Apple's _format_ framing around them.
4. **Run `pnpm run check:codesign-lockstep` after any change** — it asserts every
   declared entry point in `codesign.h` has a real body (no `NOT_IMPLEMENTED`
   return) for its phase, and that the BoringSSL dependency is the only crypto.

## Reference map (apple-codesign Rust → C++ port)

| Concern                                           | Upstream file                               | Port target                      |
| ------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| CodeDirectory (page hashes, special slots, flags) | `src/code_directory.rs` (~798)              | `code_directory.cpp`             |
| Embedded-signature SuperBlob                      | `src/embedded_signature.rs` (~1537)         | `embedded_signature.cpp`         |
| `__LINKEDIT` / `LC_CODE_SIGNATURE` surgery        | `src/macho_signing.rs` (~795)               | `macho_signing.cpp`              |
| CodeRequirement blob                              | `src/code_requirement.rs` (~2050)           | `code_requirement.cpp` (phase 2) |
| Mach-O parse helpers                              | `src/macho.rs` (~850)                       | `macho.cpp`                      |
| Crypto (RSA/ECDSA/X.509/CMS)                      | `src/cryptography.rs`, `src/certificate.rs` | **BoringSSL**, not ported        |

## Implementation order (when port work begins)

1. **Phase 1 — ad-hoc Mach-O signing.** `codesign_macho_adhoc`. Compute the
   CodeDirectory: SHA-256 over each 4 KiB (or `__LINKEDIT`-page) code page up to
   the code limit, the identifier, hashType=2 (SHA-256), flags `0x2` (adhoc), empty
   special slots. Wrap in a `CSMAGIC_EMBEDDED_SIGNATURE` (0xfade0cc0) SuperBlob with
   one `CSSLOT_CODEDIRECTORY` (0xfade0c02). Lay it at the end of `__LINKEDIT`, set/add
   `LC_CODE_SIGNATURE`'s dataoff/datasize, grow `__LINKEDIT` file/vmsize, set the code
   limit to the signature's start. Oracle: `codesign -v` passes; diff blob layout
   vs `codesign -s - <f>`. ~500–800 LoC. **Parity with binject's current ad-hoc
   signer, but standalone + cross-host.**
2. **Phase 2 — Developer-ID cert signing.** `codesign_macho_identity`.
   - **Finding (verified 2026-06-29): BoringSSL's `CMS_sign` AND `PKCS7_sign` are
     unusable for Apple signatures.** Both headers require, in signing mode,
     `certs=NULL` (no embedded cert chain) and `NOATTR` (no signed attributes) —
     Apple needs BOTH the chain embedded and a `messageDigest` signed attribute. So
     the SignedData must be **hand-built** with BoringSSL's low-level ASN.1 (`CBB_*`)
     - `EVP_DigestSign`, exactly as apple-codesign's `cryptographic-message-syntax`
       crate does. `PKCS12_parse`, `EVP_DigestSign`, `i2d_X509`, `X509_get_issuer_name`,
       `X509_get_serialNumber`, `CBB_add_asn1` are all present.
   - Hand-built `SignedData`: version, SHA-256 `digestAlgorithms`, detached
     `encapContentInfo` (id-data, no content), `certificates [0]` (leaf + chain),
     one `SignerInfo` (issuerAndSerialNumber sid, SHA-256, `signedAttrs [0]` =
     contentType id-data + signingTime + `messageDigest`=SHA-256(CD), signature over
     the DER of the attrs **re-tagged `SET OF` (0x31)** — the CMS signing gotcha).
     DER → `CSMAGIC_BLOBWRAPPER` (0xfade0b01) at `CSSLOT_SIGNATURESLOT` (0x10000).
     CD `flags = 0`.
   - **Reserve-and-pad** (the signature size is variable but hashed by the CD via
     `LC_CODE_SIGNATURE` datasize): reserve generous, patch the header, build the CD,
     sign, assemble the SuperBlob, zero-pad to the reserve. (The container half —
     PKCS12 parse, reserve-and-pad, 2-slot SuperBlob, CD `flags` param — was
     prototyped and is straightforward; the hand-built SignedData ASN.1 is the work.)
   - Start minimal (CD + sig slot, nSpecialSlots=0). If `codesign -v` demands a DR,
     add an empty `CSSLOT_REQUIREMENTS` (0xfade0c01) blob + its special-slot hash.
   - Oracle: self-signed cert with the code-signing EKU → `.p12` → `codesign -v`.
3. **Phase 3 — verify.** `codesign_macho_verify`: re-hash the pages, compare to the
   CodeDirectory, validate the SuperBlob structure (no signature-chain trust yet).
4. **Phase 4 — binject integration.** Route binject's re-sign seam through
   codesign-infra (behind a flag), retiring the LIEF/ad-hoc path. Standalone first
   per the plan — binject's working signer is untouched until this phase.

## Snapshot

| Metric                                           | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 (ad-hoc)                                 | **implemented + verified** — `codesign -v` accepts the signature on real Mach-O (test/integration/adhoc-sign.test.mts). Re-signs an existing signature slot; adding one to an unsigned binary lands with the binject seam                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Phase 2 (cert)                                   | **implemented + verified** — hand-built CMS SignedData (BoringSSL `CBB` + `EVP_DigestSign`), `codesign -v` accepts a PKCS#12 RSA-cert signature (test/integration/adhoc-sign.test.mts). Includes the Apple cdHashes signed attributes (9.1 plist + 9.2 DER) — codesign validates them (a flipped cdHash byte fails `-v`), so notarization-ready. **RSA only** — BoringSSL's `PKCS12_parse` can't extract an EC private key (verified: a valid EC `.p12` LibreSSL reads fine fails `PKCS12_parse`), so an EC identity can't be loaded; ECDSA is blocked upstream at identity load, not in the signing path. Fine in practice — Apple Developer ID certs are RSA                                              |
| Phase 3 (verify)                                 | **implemented + verified** — parses the SuperBlob → CodeDirectory, re-hashes each code page, rejects a tampered file (test/integration/adhoc-sign.test.mts). Structural seal check (no CMS trust evaluation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Phase 4 (binject seam)                           | **wired + runtime-verified** — `smol_codesign` (bin-infra, the signer shared by binject/binpress/node-smol) routes to codesign-infra's `codesign_macho_adhoc` under `-DSMOL_USE_CODESIGN_INFRA`, replacing the fork to `/usr/bin/codesign` with an in-process, cross-host signer. `make USE_CODESIGN_INFRA=1` builds binject (Makefile.macos) with codesign-infra + BoringSSL linked; running the built `smol_codesign` through the seam signs a real Mach-O and `codesign -v` passes. Opt-in (default off, build unchanged). Remaining flip: Makefile.linux/.win wiring (enables darwin-target signing from a Linux/Windows host) + making it the default once boringssl-builder is ordered as a build dep |
| Crypto via BoringSSL (no hand-rolled primitives) | enforced by design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Plan: [`.claude/plans/codesign-infra-xport.md`](../../.claude/plans/codesign-infra-xport.md).
Napi-rs uses the published `apple-codesign` Rust crate instead of this C++ port —
two intentional implementations of one capability (napi-rs is upstream-PR-bound and
Rust; socket-btm's native C/C++ stack gets the port).

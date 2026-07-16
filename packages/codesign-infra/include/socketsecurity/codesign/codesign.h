/**
 * codesign.h — Apple code signing for Mach-O, a C++ port of the signing core of
 * apple-codesign (indygreg/apple-platform-rs, MPL-2.0). Cross-platform host: it
 * signs a Mach-O from macOS, Linux, or Windows (no Apple `codesign` dependency).
 *
 * WHAT IT PORTS
 * Apple's signature *format* logic only — the CodeDirectory (per-page SHA-256
 * hashes + special slots), the embedded-signature SuperBlob, the CodeRequirement
 * blob, and the `__LINKEDIT` / `LC_CODE_SIGNATURE` layout surgery. All cryptography
 * (SHA-256, RSA, ECDSA P-256, X.509, PKCS#7/CMS for Developer-ID) comes from
 * BoringSSL (boringssl-builder) — never hand-rolled.
 *
 * WHAT IT DOES NOT
 * Notarization, remote/cloud signing, YubiKey/PKCS#11, DMG/bundle signing — the
 * heavy 30K-line surface of the upstream crate. Mach-O only (ELF/PE need no
 * signature on dlopen).
 *
 * STATUS: scaffold. Implementation is staged behind the lockstep tracker
 * docs/ports/codesign-infra-lockstep.md (phase 1 ad-hoc → 2 cert → 3 verify).
 */

#ifndef SOCKETSECURITY_CODESIGN_CODESIGN_H
#define SOCKETSECURITY_CODESIGN_CODESIGN_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Status codes. 0 = success; negatives are hard failures (What/Where/Saw/Fix is
 * carried in codesign_last_error()). */
#define CODESIGN_OK 0
#define CODESIGN_ERR_NOT_MACHO -1   /* input is not a single-arch 64-bit Mach-O */
#define CODESIGN_ERR_MALFORMED -2   /* load commands / __LINKEDIT inconsistent */
#define CODESIGN_ERR_CRYPTO -3      /* a BoringSSL primitive failed */
#define CODESIGN_ERR_IDENTITY -4    /* cert/key could not be loaded (cert signing) */
#define CODESIGN_ERR_ALLOC -5       /* out-of-memory */

/**
 * Ad-hoc sign a single-arch 64-bit Mach-O held in memory (phase 1). Produces the
 * same embedded signature `codesign -s -` would: a CodeDirectory (SHA-256, the
 * `adhoc` flag set) wrapped in an embedded-signature SuperBlob, laid into
 * `__LINKEDIT` with a fresh `LC_CODE_SIGNATURE`. `identifier` names the
 * CodeDirectory (e.g. "dev.socket.napi.compressed-addon").
 *
 * On success writes a freshly-allocated signed image to `*out`/`*out_len` (caller
 * frees with codesign_free). The input is not mutated.
 */
int codesign_macho_adhoc(const uint8_t* macho, size_t macho_len,
                         const char* identifier, uint8_t** out, size_t* out_len);

/**
 * Developer-ID sign with an identity (phase 2): a PKCS#12 (.p12) blob + passphrase
 * → the CodeDirectory is signed via PKCS#7/CMS (BoringSSL), the cert chain embedded.
 * Returns CODESIGN_ERR_IDENTITY until phase 2 lands.
 */
int codesign_macho_identity(const uint8_t* macho, size_t macho_len,
                            const char* identifier, const uint8_t* p12,
                            size_t p12_len, const char* passphrase, uint8_t** out,
                            size_t* out_len);

/**
 * Verify an embedded signature (phase 3): the CodeDirectory hashes match the file
 * and the SuperBlob is well-formed. CODESIGN_OK if valid.
 */
int codesign_macho_verify(const uint8_t* macho, size_t macho_len);

/** The last error as a What/Where/Saw/Fix string, or NULL if none. Thread-local. */
const char* codesign_last_error(void);

/** Free a buffer returned by a codesign_* function. */
void codesign_free(uint8_t* buf);

#ifdef __cplusplus
}
#endif

#endif /* SOCKETSECURITY_CODESIGN_CODESIGN_H */

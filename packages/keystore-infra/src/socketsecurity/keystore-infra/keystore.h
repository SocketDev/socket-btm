/*
 * keystore — the platform-agnostic credential store interface.
 *
 * proteus.c (the daemon lifecycle) calls these; each platform provides the
 * implementation behind the same C ABI: macOS uses the Keychain with a
 * biometric ACL (keystore_macos.mm), Linux uses the Secret Service via libsecret
 * (keystore_linux.c), and Windows uses the Credential Manager (keystore_win.c).
 * Declared extern "C" so the Objective-C++ macOS backend links against the C
 * daemon without name mangling.
 */

#ifndef PROTEUS_KEYSTORE_H
#define PROTEUS_KEYSTORE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Operation result codes. */
#define KEYSTORE_OK 0
#define KEYSTORE_ERR_UNAVAILABLE (-1) /* no backend on this platform yet */
#define KEYSTORE_ERR_NOT_FOUND (-2)   /* no such service/account pair */
#define KEYSTORE_ERR_DENIED (-3)      /* biometric prompt failed or cancelled */
#define KEYSTORE_ERR_IO (-4)          /* underlying keystore API error */

/*
 * Read a secret into `out` (NUL-terminated on KEYSTORE_OK). Reading a
 * biometric-gated item triggers the OS biometric prompt. Returns a
 * KEYSTORE_ERR_* code on failure; `out` is untouched on failure.
 */
int keystore_get(const char* service, const char* account, char* out,
                 size_t out_len);

/*
 * Store a secret behind the platform's biometric ACL where one exists. An
 * existing value for the same service/account is replaced.
 */
int keystore_put(const char* service, const char* account, const char* value);

/*
 * Remove a secret. Returns KEYSTORE_OK even when the item was already absent.
 */
int keystore_delete(const char* service, const char* account);

#ifdef __cplusplus
}
#endif

#endif /* PROTEUS_KEYSTORE_H */

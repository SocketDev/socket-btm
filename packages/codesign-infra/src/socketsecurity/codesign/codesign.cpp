/**
 * codesign.cpp — entry points for the Apple code-signing port (scaffold).
 *
 * The signing implementation is staged behind the lockstep tracker
 * (docs/ports/codesign-infra-lockstep.md): phase 1 ad-hoc → 2 Developer-ID cert →
 * 3 verify. Each entry point currently routes through CODESIGN_STUB, which records
 * a four-ingredient (What/Where/Saw/Fix) error and returns its phase's code; the
 * real body replaces the macro phase by phase. The error + free machinery here is
 * the shared surface those bodies build on.
 *
 * Crypto, when the bodies land, comes from BoringSSL (boringssl-builder) — never
 * hand-rolled. See codesign.h for the ABI contract.
 */

#include "socketsecurity/codesign/codesign.h"

#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace codesign {
// macho_signing.cpp.
int adhoc_sign_macho(const uint8_t* macho, size_t len, const std::string& identifier,
                     std::vector<uint8_t>& out, std::string& err);
int identity_sign_macho(const uint8_t* macho, size_t len, const std::string& identifier,
                        const uint8_t* p12, size_t p12_len, const char* passphrase,
                        std::vector<uint8_t>& out, std::string& err);
int verify_macho(const uint8_t* macho, size_t len, std::string& err);
}  // namespace codesign

namespace {

// Thread-local last error, exposed via codesign_last_error(). Set by CODESIGN_STUB
// and (once implemented) by each failure path, in What/Where/Saw/Fix shape.
thread_local std::string g_last_error;

void set_error(const char* what, const char* where, const char* saw, const char* fix) {
  g_last_error = std::string("codesign-infra: ") + what + ".\n  Where: " + where +
                 "\n  Saw:   " + saw + "\n  Fix:   " + fix;
}

}  // namespace

// Records a "phase N pending" error and returns `code`. The lockstep audit greps
// for this marker to know which entry points are still staged.
#define CODESIGN_STUB(phase, code)                                                 \
  do {                                                                             \
    set_error("not yet implemented", __func__, "phase " phase " is staged",        \
              "implement per docs/ports/codesign-infra-lockstep.md");              \
    return (code);                                                                 \
  } while (0)

extern "C" {

int codesign_macho_adhoc(const uint8_t* macho, size_t macho_len, const char* identifier,
                         uint8_t** out, size_t* out_len) {
  if (!macho || !identifier || !out || !out_len) {
    set_error("bad arguments", __func__, "a required pointer was null",
              "pass the Mach-O bytes, an identifier, and out pointers");
    return CODESIGN_ERR_MALFORMED;
  }
  std::vector<uint8_t> signed_image;
  std::string err;
  if (codesign::adhoc_sign_macho(macho, macho_len, identifier, signed_image, err) != 0) {
    set_error("ad-hoc signing failed", __func__, err.c_str(),
              "the input must be a 64-bit Mach-O with a code-signature slot");
    return CODESIGN_ERR_MALFORMED;
  }
  auto* buf = static_cast<uint8_t*>(std::malloc(signed_image.size()));
  if (!buf) {
    set_error("out of memory", __func__, "malloc failed", "free memory and retry");
    return CODESIGN_ERR_ALLOC;
  }
  std::memcpy(buf, signed_image.data(), signed_image.size());
  *out = buf;
  *out_len = signed_image.size();
  return CODESIGN_OK;
}

int codesign_macho_identity(const uint8_t* macho, size_t macho_len, const char* identifier,
                            const uint8_t* p12, size_t p12_len, const char* passphrase,
                            uint8_t** out, size_t* out_len) {
  if (!macho || !identifier || !p12 || !out || !out_len) {
    set_error("bad arguments", __func__, "a required pointer was null",
              "pass the Mach-O, an identifier, the PKCS#12 identity, and out pointers");
    return CODESIGN_ERR_MALFORMED;
  }
  std::vector<uint8_t> signed_image;
  std::string err;
  if (codesign::identity_sign_macho(macho, macho_len, identifier, p12, p12_len, passphrase,
                                    signed_image, err) != 0) {
    set_error("certificate signing failed", __func__, err.c_str(),
              "pass a valid PKCS#12 identity and a 64-bit Mach-O with a signature slot");
    return CODESIGN_ERR_IDENTITY;
  }
  auto* buf = static_cast<uint8_t*>(std::malloc(signed_image.size()));
  if (!buf) {
    set_error("out of memory", __func__, "malloc failed", "free memory and retry");
    return CODESIGN_ERR_ALLOC;
  }
  std::memcpy(buf, signed_image.data(), signed_image.size());
  *out = buf;
  *out_len = signed_image.size();
  return CODESIGN_OK;
}

int codesign_macho_verify(const uint8_t* macho, size_t macho_len) {
  if (!macho) {
    set_error("bad arguments", __func__, "macho pointer was null", "pass the Mach-O bytes");
    return CODESIGN_ERR_MALFORMED;
  }
  std::string err;
  if (codesign::verify_macho(macho, macho_len, err) != 0) {
    set_error("verification failed", __func__, err.c_str(),
              "the signature must seal an unmodified 64-bit Mach-O");
    return CODESIGN_ERR_MALFORMED;
  }
  return CODESIGN_OK;
}

const char* codesign_last_error(void) {
  return g_last_error.empty() ? nullptr : g_last_error.c_str();
}

void codesign_free(uint8_t* buf) {
  std::free(buf);
}

}  // extern "C"

/**
 * Required-files manifest for a curl + mbedTLS install.
 *
 * Curl-builder's CMake build produces curl + mbedTLS as a unit; the
 * stubs builder links all four libs at the same time. All four must
 * exist in the install dir for the install to be considered complete.
 *
 * Libcurl.a       — HTTP client
 * libmbedtls.a    — TLS protocol
 * libmbedx509.a   — X.509 cert handling
 * libmbedcrypto.a — cryptographic primitives.
 *
 * Kept in its own file with zero imports so verify-release scripts
 * can read it standalone without workspace resolution.
 */
export const CURL_REQUIRED_FILES = [
  'libcurl.a',
  'libmbedtls.a',
  'libmbedx509.a',
  'libmbedcrypto.a',
]

/**
 * Required-files manifest for a BoringSSL install — source of truth shared
 * by scripts/repo/build.mts (drives checkpoint validation) and
 * scripts/verify-release.mts (runs in CI before archiving). Kept in
 * its own file with zero imports so verify-release can stay
 * standalone and avoid workspace-resolution failures on runners where
 * the `build-infra` symlink is missing.
 *
 * BoringSSL is built with -DBORINGSSL_PREFIX=smol; the prefix renames C
 * symbols, not the archive filenames. The build.mts publish step copies
 * the artifacts to libsmol_crypto.{a,lib} + libsmol_ssl.{a,lib} so the
 * filename + symbol prefix line up.
 */
export const BORINGSSL_REQUIRED_FILES = [
  ['lib/libsmol_crypto.a', 'lib/smol_crypto.lib'],
  ['lib/libsmol_ssl.a', 'lib/smol_ssl.lib'],
  'include/openssl/ssl.h',
  'include/openssl/crypto.h',
]

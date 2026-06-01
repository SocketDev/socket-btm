{
  # BoringSSL — Google's OpenSSL fork. Built with -DBORINGSSL_PREFIX=smol so
  # every public symbol (SSL_CTX_new, HKDF_extract, EVP_AEAD_*, ...) becomes
  # smol_SSL_CTX_new, smol_HKDF_extract, etc. Links cleanly alongside Node's
  # bundled OpenSSL — the prefixed libs are only consumed by node:smol-http
  # (lsquic + uWebSockets transport).
  #
  # Built by boringssl-builder; the prebuilt static libs + prefixed headers
  # are downloaded + copied here before Node.js configure.
  'targets': [
    {
      'target_name': 'boringssl',
      'type': 'none',
      'direct_dependent_settings': {
        'include_dirs': [
          'include',
        ],
        # The prebuilt libs are built with -DBORINGSSL_PREFIX=smol, so every
        # public symbol is exported as smol_<sym>. Dependents include the staged
        # BoringSSL headers (which #define OPENSSL_IS_BORINGSSL via base.h), so
        # they compile BoringSSL code paths (e.g. node::crypto's EVP_AEAD calls
        # under #ifdef OPENSSL_IS_BORINGSSL). Those headers only remap calls to
        # the smol_ prefix when BORINGSSL_PREFIX is defined (prefix_symbols.h is
        # gated on `#if defined(BORINGSSL_PREFIX)`). Propagate the define so a
        # dependent's calls resolve to the prefixed symbols the libs actually
        # export — without it the link fails with undefined _EVP_aead_*/_SSL_CTX_*.
        'defines': [
          'BORINGSSL_PREFIX=smol',
        ],
        'conditions': [
          ['OS=="win"', {
            'libraries': [
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/smol_ssl.lib',
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/smol_crypto.lib',
            ],
          }],
          ['OS!="win"', {
            'libraries': [
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/libsmol_ssl.a',
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/libsmol_crypto.a',
            ],
          }],
        ],
      },
    },
  ],
}

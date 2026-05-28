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

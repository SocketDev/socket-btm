{
  # BoringSSL — Google's OpenSSL fork. Built with -DBORINGSSL_PREFIX=smol so
  # every public symbol (SSL_CTX_new, HKDF_extract, EVP_AEAD_*, ...) becomes
  # smol_SSL_CTX_new, smol_HKDF_extract, etc. node-smol uses BoringSSL as its
  # crypto/TLS provider: node::crypto compiles the OPENSSL_IS_BORINGSSL paths
  # (the staged base.h defines it), and node:smol-http (lsquic + uWebSockets)
  # also consumes it. The smol_ prefix keeps these from colliding with any
  # bundled-OpenSSL symbols.
  #
  # Built by boringssl-builder; the prebuilt static libs + prefixed headers
  # are downloaded + copied here before Node.js configure.
  'targets': [
    {
      'target_name': 'boringssl',
      'type': 'none',
      # Ensure the prebuilt libs are staged before any dependent links.
      'hard_dependency': 1,
      # COMPILE-time settings for DIRECT dependents (e.g. libnode): the include
      # path + the BORINGSSL_PREFIX define. The prebuilt libs are built with
      # -DBORINGSSL_PREFIX=smol, so every public symbol is exported smol_<sym>.
      # Dependents include the staged headers (base.h #defines OPENSSL_IS_BORINGSSL),
      # so they compile BoringSSL code paths (e.g. node::crypto's EVP_AEAD calls
      # under #ifdef OPENSSL_IS_BORINGSSL). prefix_symbols.h only remaps those
      # calls to the smol_ prefix when BORINGSSL_PREFIX is defined (it is gated on
      # `#if defined(BORINGSSL_PREFIX)`), so without this define a dependent calls
      # the unprefixed names and the link fails with undefined _EVP_aead_*/_SSL_CTX_*.
      'direct_dependent_settings': {
        'include_dirs': [
          'include',
        ],
        'defines': [
          'BORINGSSL_PREFIX=smol',
        ],
      },
      # LINK-time settings propagate transitively to the final executable (the
      # `node` binary that links the libnode static lib). direct_dependent_settings
      # libraries would attach to the libnode *static archive*, which never runs a
      # linker, so the .a files would be dropped and the smol_-prefixed symbols
      # would stay unresolved. link_settings is gyp's canonical channel for a
      # prebuilt lib to reach the executable's link line (same pattern as
      # deps/crates/crates.gyp and deps/ngtcp2).
      #
      # Order matters for order-strict linkers (GNU ld/gold on Linux): ssl needs
      # crypto, and crypto+decrepit are MUTUALLY dependent — crypto's cipher
      # registry (get_cipher.cc) references decrepit's EVP_bf_*/EVP_aes_*_cfb128,
      # while decrepit uses crypto's EVP infrastructure. Listing crypto a second
      # time after decrepit resolves the cycle without needing --start-group
      # (repeating an archive is the portable way to satisfy a static circular
      # dep). macOS ld64 resolves archives iteratively so order is forgiving
      # there, but the repeat keeps the Linux link correct too.
      'link_settings': {
        'conditions': [
          ['OS=="win"', {
            'libraries': [
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/smol_ssl.lib',
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/smol_crypto.lib',
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/smol_decrepit.lib',
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/smol_crypto.lib',
            ],
          }],
          ['OS!="win"', {
            'libraries': [
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/libsmol_ssl.a',
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/libsmol_crypto.a',
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/libsmol_decrepit.a',
              '<(PRODUCT_DIR)/../../deps/boringssl/lib/libsmol_crypto.a',
            ],
          }],
        ],
      },
    },
  ],
}

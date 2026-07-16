{
  # libpq - PostgreSQL client library
  # Wraps prebuilt libpq static library for Node.js integration.
  # The prebuilt library is downloaded via libpq-builder and copied here before configure.
  # Source: https://www.postgresql.org/
  # License: PostgreSQL License (similar to BSD/MIT)
  'targets': [
    {
      'target_name': 'libpq',
      'type': 'none',
      # This is a wrapper for a prebuilt static library.
      # The library and headers must be copied here before Node.js configure.
      'direct_dependent_settings': {
        'include_dirs': [
          'include',
        ],
        'conditions': [
          ['OS=="win"', {
            'libraries': [
              '<(PRODUCT_DIR)/../../deps/libpq/libpq.a',
              '<(PRODUCT_DIR)/../../deps/libpq/libpgcommon.a',
              '<(PRODUCT_DIR)/../../deps/libpq/libpgport.a',
              '-lws2_32',
              '-lsecur32',
              '-ladvapi32',
              '-lcrypt32',
            ],
          }],
          ['OS!="win"', {
            'libraries': [
              '<(PRODUCT_DIR)/../../deps/libpq/libpq.a',
              '<(PRODUCT_DIR)/../../deps/libpq/libpgcommon.a',
              '<(PRODUCT_DIR)/../../deps/libpq/libpgport.a',
            ],
          }],
        ],
      },
    },
  ],
}

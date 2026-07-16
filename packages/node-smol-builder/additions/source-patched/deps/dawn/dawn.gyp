{
  # Dawn - Google's WebGPU implementation
  # Wraps prebuilt libwebgpu_dawn static library for Node.js integration.
  # The prebuilt library is downloaded via dawn-builder and copied here before configure.
  # Source: https://dawn.googlesource.com/dawn
  # License: BSD-3-Clause
  'targets': [
    {
      'target_name': 'dawn',
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
              '<(PRODUCT_DIR)/../../deps/dawn/lib/webgpu_dawn.lib',
            ],
          }],
          ['OS!="win"', {
            'libraries': [
              '<(PRODUCT_DIR)/../../deps/dawn/lib/libwebgpu_dawn.a',
            ],
          }],
        ],
      },
    },
  ],
}

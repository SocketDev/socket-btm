{
  'targets': [
    {
      'target_name': 'smol_ai',
      'type': 'none',
      'hard_dependency': 1,
      # The core and llama.cpp are compiled by CMake before Node configure.
      # They stay outside libnode's global -fno-exceptions policy and arrive
      # here as checksum/pin-keyed static libraries.
      'link_settings': {
        'conditions': [
          ['OS=="win"', {
            'libraries': [
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/smol_ai_core.lib',
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/llama.lib',
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/ggml.lib',
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/ggml-cpu.lib',
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/ggml-base.lib',
            ],
          }],
          ['OS!="win"', {
            'libraries': [
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/libsmol_ai_core.a',
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/libllama.a',
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/libggml.a',
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/libggml-cpu.a',
              '<(PRODUCT_DIR)/../../deps/smol-ai/lib/libggml-base.a',
              '-lm',
            ],
          }],
          ['OS=="linux"', {
            'libraries': [ '-ldl' ],
          }],
        ],
      },
    },
  ],
}

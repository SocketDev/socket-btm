{
  'targets': [
    {
      'target_name': 'liblzfse',
      'type': 'static_library',
      'sources': [
        'src/lzfse_encode.c',
        'src/lzfse_decode.c',
        'src/lzfse_encode_base.c',
        'src/lzfse_decode_base.c',
        'src/lzvn_encode_base.c',
        'src/lzvn_decode_base.c',
        'src/lzfse_fse.c',
      ],
      'include_dirs': [
        'src',
      ],
      'direct_dependent_settings': {
        'include_dirs': [
          'src',
        ],
      },
      'defines': [
        'NDEBUG',
      ],
      'conditions': [
        ['OS!="win"', {
          'defines': [
            '_POSIX_C_SOURCE',
          ],
        }],
      ],
      'cflags': [
        '-O2',
        '-Wall',
        '-Wno-unknown-pragmas',
        '-Wno-unused-variable',
        '-std=c99',
        '-fvisibility=hidden',
      ],
      'xcode_settings': {
        'WARNING_CFLAGS': [
          '-Wall',
          '-Wno-unknown-pragmas',
          '-Wno-unused-variable',
        ],
        'OTHER_CFLAGS': [
          '-O2',
          '-fvisibility=hidden',
        ],
        'GCC_C_LANGUAGE_STANDARD': 'c99',
      },
      'msvs_settings': {
        'VCCLCompilerTool': {
          'WarningLevel': '3',
          'Optimization': '2',
        },
      },
    },
  ],
}

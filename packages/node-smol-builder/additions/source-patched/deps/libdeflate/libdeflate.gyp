{
  'targets': [
    {
      'target_name': 'libdeflate',
      'type': 'static_library',
      'sources': [
        'lib/adler32.c',
        'lib/crc32.c',
        'lib/deflate_compress.c',
        'lib/deflate_decompress.c',
        'lib/gzip_compress.c',
        'lib/gzip_decompress.c',
        'lib/utils.c',
        'lib/zlib_compress.c',
        'lib/zlib_decompress.c',
        # Architecture-specific CPU feature detection (required for SIMD optimizations)
        'lib/arm/cpu_features.c',
        'lib/x86/cpu_features.c',
      ],
      'include_dirs': [
        '.',
        'lib',
      ],
      'direct_dependent_settings': {
        'include_dirs': [
          '.',
          'lib',
        ],
      },
      'defines': [
        'NDEBUG',
        'LIBDEFLATE_DLL=0',
      ],
      'cflags': [
        '-O2',
        '-Wall',
        '-Wno-unused-function',
        '-std=c99',
        '-fvisibility=hidden',
      ],
      'xcode_settings': {
        'WARNING_CFLAGS': [
          '-Wall',
          '-Wno-unused-function',
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

# http.gypi
# Build configuration for socketsecurity/http native bindings
#
# Includes:
# - smol_http: Node.js internal binding for node:smol-http
# - uSockets: High-performance socket library (libuv backend)
# - uWebSockets headers: HTTP parser, cork buffer, response writer (header-only)

{
  'targets': [
    # =========================================================================
    # uSockets — low-level socket library with libuv backend
    # =========================================================================
    {
      'target_name': 'usockets',
      'type': 'static_library',
      'sources': [
        # Core sources — compiled as C
        '<(node_root_dir)/deps/uSockets/src/bsd.c',
        '<(node_root_dir)/deps/uSockets/src/context.c',
        '<(node_root_dir)/deps/uSockets/src/loop.c',
        '<(node_root_dir)/deps/uSockets/src/socket.c',
        # libuv event loop backend (integrates with Node.js event loop)
        '<(node_root_dir)/deps/uSockets/src/eventing/libuv.c',
      ],
      'include_dirs': [
        '<(node_root_dir)/deps/uSockets/src',
        '<(node_root_dir)/deps/uv/include',
      ],
      'defines': [
        # Use libuv backend (not raw epoll/kqueue) for Node.js integration
        'LIBUS_USE_LIBUV',
        # No OpenSSL — we use Node.js TLS, not uSockets crypto
        'LIBUS_NO_SSL',
      ],
      'conditions': [
        ['OS=="win"', {
          'defines': [
            'WIN32_LEAN_AND_MEAN',
            'NOMINMAX',
          ],
        }],
        ['OS=="mac"', {
          'xcode_settings': {
            'MACOSX_DEPLOYMENT_TARGET': '10.15',
            'OTHER_CFLAGS': [
              '-fvisibility=hidden',
            ],
          },
        }],
        ['OS=="linux"', {
          'cflags': [
            '-fvisibility=hidden',
          ],
        }],
      ],
    },

    # =========================================================================
    # smol_http — Node.js internal binding for node:smol-http
    # =========================================================================
    {
      'target_name': 'smol_http',
      'type': 'static_library',
      'dependencies': [
        '<(node_lib_target)',
        'usockets',
      ],
      'sources': [
        '../simd/simd.cc',
        'http_binding.cc',
        'http_fast_response.cc',
        'http_object_pool.cc',
        'iouring_network.cc',
        'mimalloc_allocator.cc',
        'smol_http_binding.cc',
        'uws_server.cc',
      ],
      'include_dirs': [
        '../..',
        '../../socketsecurity/simd',
        '<(node_root_dir)/src',
        '<(node_root_dir)/deps/v8/include',
        '<(node_root_dir)/deps/uv/include',
        # uSockets and uWebSockets headers
        '<(node_root_dir)/deps/uSockets/src',
        '<(node_root_dir)/deps/uWebSockets/src',
      ],
      'defines': [
        'NODE_WANT_INTERNALS=1',
        'LIBUS_USE_LIBUV',
        'LIBUS_NO_SSL',
        # Disable uWebSockets version header (uWebSockets: 20) and Date header.
        # Saves 8 Super::write() calls per response (~160ns).
        'UWS_HTTPRESPONSE_NO_WRITEMARK',
      ],
      'conditions': [
        # Platform-specific configurations
        ['OS=="win"', {
          'defines': [
            'WIN32_LEAN_AND_MEAN',
            'NOMINMAX',
          ],
          'msvs_settings': {
            'VCCLCompilerTool': {
              'AdditionalOptions': [
                '/std:c++17',
                '/Zc:__cplusplus',
              ],
              # Enable SSE2 on x86 Windows
              'EnableEnhancedInstructionSet': '2',  # /arch:SSE2
            },
          },
        }],
        ['OS=="mac"', {
          'xcode_settings': {
            'GCC_ENABLE_CPP_EXCEPTIONS': 'NO',
            'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
            'CLANG_CXX_LIBRARY': 'libc++',
            'MACOSX_DEPLOYMENT_TARGET': '10.15',
            'OTHER_CPLUSPLUSFLAGS': [
              '-fno-rtti',
              '-fno-exceptions',
            ],
          },
          'conditions': [
            ['target_arch=="x64"', {
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': [
                  '-msse4.1',
                  '-mavx2',
                ],
              },
            }],
            ['target_arch=="arm64"', {
              # NEON is always available on ARM64
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': [
                  '-march=armv8-a+simd',
                ],
              },
            }],
          ],
        }],
        ['OS=="linux"', {
          'cflags_cc': [
            '-std=c++17',
            '-fno-rtti',
            '-fno-exceptions',
            '-fvisibility=hidden',
          ],
          'conditions': [
            ['target_arch=="x64"', {
              'cflags_cc': [
                '-msse2',
                '-msse4.1',
                # AVX2 detection happens at runtime
              ],
            }],
            ['target_arch=="arm64"', {
              'cflags_cc': [
                '-march=armv8-a+simd',
              ],
            }],
            ['target_arch=="arm"', {
              'cflags_cc': [
                '-mfpu=neon',
                '-mfloat-abi=hard',
              ],
            }],
          ],
        }],
        ['OS=="freebsd" or OS=="openbsd" or OS=="netbsd"', {
          'cflags_cc': [
            '-std=c++17',
            '-fno-rtti',
            '-fno-exceptions',
          ],
        }],
        # Architecture-specific optimizations
        ['target_arch=="ia32"', {
          'defines': [
            'SMOL_ARCH_X86=1',
          ],
        }],
        ['target_arch=="x64"', {
          'defines': [
            'SMOL_ARCH_X64=1',
          ],
        }],
        ['target_arch=="arm"', {
          'defines': [
            'SMOL_ARCH_ARM32=1',
          ],
        }],
        ['target_arch=="arm64"', {
          'defines': [
            'SMOL_ARCH_ARM64=1',
          ],
        }],
      ],
    },
  ],
}

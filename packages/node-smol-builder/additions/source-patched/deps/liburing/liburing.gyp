{
  # liburing - Linux io_uring library
  # Only built on Linux (io_uring is a Linux kernel feature).
  # Source: https://github.com/axboe/liburing
  # License: MIT/LGPL-2.1
  'targets': [
    {
      'target_name': 'liburing',
      'type': 'static_library',
      'conditions': [
        ['OS=="linux"', {
          'sources': [
            'src/queue.c',
            'src/register.c',
            'src/setup.c',
            'src/syscall.c',
            'src/version.c',
            'src/sanitize.c',
          ],
          'include_dirs': [
            'src/include',
          ],
          'direct_dependent_settings': {
            'include_dirs': [
              'src/include',
            ],
          },
          'defines': [
            'NDEBUG',
            '_GNU_SOURCE',
          ],
          'cflags': [
            '-O2',
            '-Wall',
            '-Wextra',
            '-Wno-unused-parameter',
            '-fvisibility=hidden',
            '-fno-stack-protector',
          ],
        }],
        ['OS!="linux"', {
          # On non-Linux platforms, create empty library (no sources).
          # Dependents should check OS before linking.
          'sources': [],
        }],
      ],
    },
  ],
}

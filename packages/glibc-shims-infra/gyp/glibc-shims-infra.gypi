{
  # glibc-shims-infra — drop-in gypi for fleet Linux binaries that want to
  # run on glibc >= 2.17. Consumers include this gypi from their own gyp
  # file and the shim source files + the --wrap link flags are merged in.
  #
  # Sources are compiled only on Linux+glibc (gated at preprocessor time
  # in each .c). On musl/macOS/Windows the files compile to empty TUs
  # and the --wrap flags below are no-ops.
  'conditions': [
    ['OS=="linux"', {
      'sources': [
        'src/socketsecurity/glibc-2-17-compat/shims/at_quick_exit.c',
        'src/socketsecurity/glibc-2-17-compat/shims/cxa_thread_atexit_impl.c',
        'src/socketsecurity/glibc-2-17-compat/shims/getrandom.c',
        'src/socketsecurity/glibc-2-17-compat/shims/quick_exit.c',
      ],
      'include_dirs': [
        'src',
      ],
      # The --wrap flags activate the __wrap_<symbol> dispatchers. Without
      # them, callers reach the unwrapped glibc symbol directly and the
      # shims are dead code.
      'ldflags': [
        '-Wl,--wrap=__cxa_thread_atexit_impl',
        '-Wl,--wrap=at_quick_exit',
        '-Wl,--wrap=getrandom',
        '-Wl,--wrap=quick_exit',
      ],
      # libdl is what dlsym(RTLD_NEXT, …) needs on glibc < 2.34. Static
      # libdl is fine — the symbol surface is tiny.
      'libraries': [
        '-ldl',
      ],
      'direct_dependent_settings': {
        'include_dirs': [
          'src',
        ],
        'ldflags': [
          '-Wl,--wrap=__cxa_thread_atexit_impl',
          '-Wl,--wrap=at_quick_exit',
          '-Wl,--wrap=getrandom',
          '-Wl,--wrap=quick_exit',
        ],
        'libraries': [
          '-ldl',
        ],
      },
    }],
  ],
}

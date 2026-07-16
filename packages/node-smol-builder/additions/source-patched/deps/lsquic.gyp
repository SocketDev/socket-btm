# lsquic + ls-hpack + ls-qpack as a standalone static library.
#
# Compiling this vendored third-party C as its own target — rather than
# folding the sources into libnode — lets it carry its own warning policy.
# node's target_defaults promote -Werror=extra-semi / -Werror=undefined-inline
# (trailing semicolons in xxhash macros, cross-TU inline helpers), which is
# right for node's own code but wrong for upstream we don't maintain; a
# `cflags!` / `WARNING_CFLAGS!` strip on this target is the only reliable way
# to relax it (gyp drops cflags merged into libnode via an `includes`-d gypi,
# and per-condition cflags never reach those sources).
#
# The actual source lists live in the auto-generated lsquic.gypi /
# ls-qpack.gypi / lshpack.gypi (emitted by prepare-external-sources.mts); they
# also carry the HAVE_BORINGSSL + XXH_INLINE_ALL / XXH_HEADER_NAME defines that
# select lsquic's BoringSSL crypto path and make the bundled xxhash header-only
# (so the two xxhash copies don't collide as duplicate symbols).
{
  'targets': [
    {
      'target_name': 'lsquic',
      'type': 'static_library',
      'includes': [
        'lsquic.gypi',
        'ls-qpack.gypi',
        'lshpack.gypi',
      ],
      # BoringSSL's direct_dependent_settings supply its include path + the
      # BORINGSSL_PREFIX=smol define, so lsquic's crypto compiles against the
      # same prefixed symbols libnode links.
      'dependencies': [
        'boringssl/boringssl.gyp:boringssl',
      ],
      'include_dirs': [
        'lsquic/include',
        'lsquic/src/liblsquic',
        'lsquic/src/lshpack',
        'lsquic/src/lshpack/deps/xxhash',
        'ls-qpack',
        'ls-qpack/deps/xxhash',
      ],
      'cflags!': [
        '-Werror=extra-semi',
        '-Werror=undefined-inline',
      ],
      'xcode_settings': {
        'WARNING_CFLAGS!': [
          '-Werror=extra-semi',
          '-Werror=undefined-inline',
          '-Werror=ctad-maybe-unsupported',
        ],
      },
      # Consumers (the node:smol-quic binding .cc files in libnode) #include
      # lsquic / lsxpack / lsqpack headers bare.
      'direct_dependent_settings': {
        'include_dirs': [
          'lsquic/include',
          'lsquic/src/liblsquic',
          'lsquic/src/lshpack',
          'ls-qpack',
        ],
      },
    },
  ],
}

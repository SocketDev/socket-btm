/**
 * Canonical link-flag bundle for the glibc 2.17 shim layer.
 *
 * Consumers import this list to inject -Wl,--wrap=<symbol> entries into their
 * own gyp/cmake/ld invocations. Per fleet rule "1 path, 1 reference" — never
 * hand-write these flags in downstream build files; import them.
 *
 * The order of entries is alphabetical for stable diffs; the linker is
 * order-agnostic for --wrap flags.
 */

export const GLIBC_SHIMS_WRAP_SYMBOLS: readonly string[] = [
  '__cxa_thread_atexit_impl',
  'at_quick_exit',
  'getrandom',
  'quick_exit',
]

/**
 * Linker flags as a flat array, ready to splice into ldflags. Each entry is
 * a single -Wl,--wrap=<symbol> argument; consumers don't need to know the
 * exact form.
 */
export const GLIBC_SHIMS_LINK_FLAGS: readonly string[] =
  GLIBC_SHIMS_WRAP_SYMBOLS.map(s => `-Wl,--wrap=${s}`)

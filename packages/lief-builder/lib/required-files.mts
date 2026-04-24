/**
 * Required-files manifest for a LIEF install — source of truth shared
 * by scripts/build.mts (drives checkpoint validation) and
 * scripts/verify-release.mts (runs in CI before archiving). Kept in
 * its own file with zero imports so verify-release can stay
 * standalone and avoid workspace-resolution failures on runners where
 * the `build-infra` symlink is missing.
 *
 * Each entry is either a single required path or an array of
 * alternatives (any one must exist). The alternative exists for the
 * library naming convention:
 *   MSVC on Windows: LIEF.lib
 *   MinGW/llvm-mingw on Windows and Unix: libLIEF.a
 */
export const LIEF_REQUIRED_FILES = [
  ['libLIEF.a', 'LIEF.lib'],
  'include/LIEF/LIEF.hpp',
  'include/LIEF/config.h',
]

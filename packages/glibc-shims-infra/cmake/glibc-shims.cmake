# glibc-shims-infra cmake module — drop-in for cmake-driven C/C++
# builds that want their output to run on glibc 2.17.
#
# Wire from a consumer CMakeLists.txt (target_* calls alphabetical per
# the fleet sorting rule):
#
#   include(${CMAKE_CURRENT_LIST_DIR}/../../glibc-shims-infra/cmake/glibc-shims.cmake)
#   target_include_directories(<your-target> PRIVATE ${GLIBC_SHIMS_INCLUDE_DIR})
#   target_link_options(<your-target> PRIVATE ${GLIBC_SHIMS_LINK_OPTIONS})
#   target_sources(<your-target> PRIVATE ${GLIBC_SHIMS_SOURCES})
#
# Mirror of gyp/glibc-shims-infra.gypi for cmake projects. See README.md
# in the package root for the symbol contract.

get_filename_component(GLIBC_SHIMS_INFRA_ROOT
  "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)

set(GLIBC_SHIMS_INCLUDE_DIR
  "${GLIBC_SHIMS_INFRA_ROOT}/src"
  CACHE INTERNAL "glibc-shims-infra include directory")

set(_GLIBC_SHIMS_SRC
  "${GLIBC_SHIMS_INFRA_ROOT}/src/socketsecurity/glibc-2-17-compat/shims")

# Shim source files. Each .cc gates with `#if defined(__GLIBC__) &&
# defined(__linux__)` so they compile to empty TUs on musl/macOS/Windows.
# Alphabetical for stable diffs.
set(GLIBC_SHIMS_SOURCES
  "${_GLIBC_SHIMS_SRC}/at_quick_exit.cc"
  "${_GLIBC_SHIMS_SRC}/cxa_thread_atexit_impl.cc"
  "${_GLIBC_SHIMS_SRC}/getrandom.cc"
  "${_GLIBC_SHIMS_SRC}/quick_exit.cc"
  CACHE INTERNAL "glibc-shims-infra source files")

# --wrap flags activate the __wrap_<symbol> dispatchers. Without them,
# callers reach the unwrapped glibc symbol directly and the shims are
# dead code. Linux-only — no-op on non-Linux platforms.
#
# -ldl: dlsym(RTLD_NEXT, …) needs it on glibc < 2.34.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  set(GLIBC_SHIMS_LINK_OPTIONS
    "-Wl,--wrap=__cxa_thread_atexit_impl"
    "-Wl,--wrap=at_quick_exit"
    "-Wl,--wrap=getrandom"
    "-Wl,--wrap=quick_exit"
    "-ldl"
    CACHE INTERNAL "glibc-shims-infra linker options")
else()
  set(GLIBC_SHIMS_LINK_OPTIONS
    ""
    CACHE INTERNAL "glibc-shims-infra linker options (non-Linux: empty)")
endif()

# glibc-shims-infra Makefile include — drop-in for any binsuite or
# C/C++ Makefile that wants its output binary to run on glibc 2.17.
#
# Mirrors gyp/glibc-shims-infra.gypi for build systems that can't include
# gyp. Wire from a consumer Makefile (variables alphabetical per the
# fleet sorting rule):
#
#   include ../glibc-shims-infra/make/glibc-shims.mk
#   CXXFLAGS += $(GLIBC_SHIMS_CFLAGS)
#   LDFLAGS += $(GLIBC_SHIMS_LDFLAGS)
#   SOURCES += $(GLIBC_SHIMS_SOURCES)
#
# The shim symbols are linker-rewritten via -Wl,--wrap=<symbol>; on glibc
# >= 2.34 the dlsym path runs unchanged, on glibc 2.17 the fallback runs.
# Same binary works everywhere.
#
# Per fleet rule "1 path, 1 reference": never hand-write -Wl,--wrap=
# flags or shim file paths in downstream Makefiles. Always import.

GLIBC_SHIMS_INFRA_ROOT := $(dir $(lastword $(MAKEFILE_LIST)))..

GLIBC_SHIMS_SRC := $(GLIBC_SHIMS_INFRA_ROOT)/src/socketsecurity/glibc-2-17-compat/shims
GLIBC_SHIMS_INCLUDE := $(GLIBC_SHIMS_INFRA_ROOT)/src

# Shim source files — gated at preprocessor time in each .c to compile
# to an empty TU on non-Linux/non-glibc platforms. Safe to include
# unconditionally; the linker drops them on musl/macOS/Windows.
#
# Order is alphabetical for stable diffs; the linker is order-agnostic
# for translation units.
GLIBC_SHIMS_SOURCES := \
  $(GLIBC_SHIMS_SRC)/at_quick_exit.c \
  $(GLIBC_SHIMS_SRC)/cxa_thread_atexit_impl.c \
  $(GLIBC_SHIMS_SRC)/getrandom.c \
  $(GLIBC_SHIMS_SRC)/quick_exit.c

# Include path for the shim umbrella header + internal helpers.
GLIBC_SHIMS_CFLAGS := -I$(GLIBC_SHIMS_INCLUDE)

# --wrap flags activate the __wrap_<symbol> dispatchers. Without them,
# callers reach the unwrapped glibc symbol directly and the shims are
# dead code. Alphabetical for stable diffs.
#
# -ldl is needed for dlsym(RTLD_NEXT, …) on glibc < 2.34. Static libdl
# is fine — the symbol surface is tiny.
GLIBC_SHIMS_LDFLAGS := \
  -Wl,--wrap=__cxa_thread_atexit_impl \
  -Wl,--wrap=at_quick_exit \
  -Wl,--wrap=getrandom \
  -Wl,--wrap=quick_exit \
  -ldl

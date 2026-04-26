# Linux-specific compiler and flags.

CC ?= gcc
CXX ?= g++

# Enable POSIX and GNU extensions (required for strtok_r, usleep, setenv,
# fileno, realpath when compiling with -std=c11 on musl).
POSIX_MACROS = -D_GNU_SOURCE

# Detect musl vs glibc at build time.
# musl includes pthread and libdl in libc, so -lpthread -ldl are unnecessary.
IS_MUSL := $(shell ldd --version 2>&1 | grep -q musl && echo 1 || echo 0)

# Build mode flags.
# PATH_REMAP_FLAGS (from common.mk) anonymize host filesystem paths in DWARF
# and __FILE__ macros so shipped binaries don't leak the dev's home dir...
ifeq ($(BUILD_MODE),prod)
    # Production: optimize for size and speed.
    # -Os: Optimize for size
    # -flto: Link-Time Optimization for 5-15% smaller binaries
    # -ffunction-sections -fdata-sections: Enable dead code elimination with --gc-sections
    # Note: Linux stripping is done post-build with plain strip (no -s flag) to preserve pthread symbols.
    OPT_FLAGS = -Os -DNDEBUG -flto -ffunction-sections -fdata-sections $(PATH_REMAP_FLAGS)
else
    # Development: optimize for build speed, keep debug symbols.
    OPT_FLAGS = -O0 -g $(PATH_REMAP_FLAGS)
endif

# Linux-specific linker flags base.
# -static: Fully static linking
# -Wl,--gc-sections: Remove unused sections (works with -ffunction-sections -fdata-sections)
# -flto: Required for LTO to work during linking (must match compiler flags)
ifeq ($(BUILD_MODE),prod)
    LDFLAGS_BASE = -static -flto -Wl,--gc-sections
else
    LDFLAGS_BASE = -static -Wl,--gc-sections
endif

# Standard libraries for Linux builds.
# musl includes pthread and libdl in libc, so only link them on glibc.
LINUX_STD_LIBS =
ifeq ($(IS_MUSL),0)
    LINUX_STD_LIBS += -lpthread -ldl
endif

# Post-build strip command.
ifeq ($(BUILD_MODE),prod)
define STRIP_BINARY
	@echo "Stripping debug symbols (preserves pthread symbols)..."
	strip $(1)
endef
else
define STRIP_BINARY
endef
endif

# Clean command implementation.
define CLEAN_IMPL
	@echo "Cleaning build artifacts..."
	@find build/dev build/prod -type f -name '*.o' -delete 2>/dev/null || true
	@find build/dev build/prod -type f -name '*.gcda' -delete 2>/dev/null || true
	@find build/dev build/prod -type f -name '*.gcno' -delete 2>/dev/null || true
	@rm -f build/dev/$(1)_test build/prod/$(1)_test 2>/dev/null || true
	@rm -f build/dev/$(1)_test_coverage build/prod/$(1)_test_coverage 2>/dev/null || true
	@rm -rf build/dev/out build/prod/out 2>/dev/null || true
endef

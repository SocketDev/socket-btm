# macOS-specific compiler and flags.

CC = /usr/bin/clang
CXX = /usr/bin/clang++

# Build mode flags.
ifeq ($(BUILD_MODE),prod)
    # Production: optimize for size and speed, strip symbols.
    # Note: macOS uses -Wl,-dead_strip instead of -s (which is obsolete on macOS).
    OPT_FLAGS = -Os -DNDEBUG
else
    # Development: optimize for build speed, keep debug symbols.
    OPT_FLAGS = -O0 -g
endif

# macOS-specific POSIX feature macros.
POSIX_MACROS = -D_POSIX_C_SOURCE=200809L -D_XOPEN_SOURCE=700

# liblzma paths (from Homebrew).
LZMA_PREFIX ?= $(shell brew --prefix xz 2>/dev/null || echo "/usr/local")
LZMA_INCLUDE = $(LZMA_PREFIX)/include
LZMA_LIB = $(LZMA_PREFIX)/lib

# macOS-specific linker flags base.
LDFLAGS_BASE = -lcompression -L$(LZMA_LIB) -llzma -Wl,-dead_strip

# Binary signing command.
define SIGN_BINARY
	@# Sign binary with ad-hoc signature on macOS (required for Node.js spawn).
	@codesign -s - $(1) 2>/dev/null || true
	@echo "Signed: $(1)"
endef

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

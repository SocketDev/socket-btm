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

# Cross-compilation support for macOS.
# When TARGET_ARCH is set, add -arch flags for cross-compilation.
ifdef TARGET_ARCH
    ifeq ($(TARGET_ARCH),x64)
        ARCH_FLAGS = -arch x86_64
    else ifeq ($(TARGET_ARCH),x86_64)
        ARCH_FLAGS = -arch x86_64
    else ifeq ($(TARGET_ARCH),arm64)
        ARCH_FLAGS = -arch arm64
    else ifeq ($(TARGET_ARCH),aarch64)
        ARCH_FLAGS = -arch arm64
    endif
    OPT_FLAGS += $(ARCH_FLAGS)
endif

# macOS-specific POSIX feature macros.
POSIX_MACROS = -D_POSIX_C_SOURCE=200809L -D_XOPEN_SOURCE=700

# macOS-specific linker flags base.
# -lcompression links Apple's native compression framework (LZFSE, zlib, etc.)
LDFLAGS_BASE = -lcompression -Wl,-dead_strip

# Add architecture flags to linker for cross-compilation.
ifdef ARCH_FLAGS
    LDFLAGS_BASE += $(ARCH_FLAGS)
endif

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

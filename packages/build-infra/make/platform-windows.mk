# Windows-specific compiler and flags.

CC ?= gcc
CXX ?= g++

# Build mode flags.
ifeq ($(BUILD_MODE),prod)
    # Production: optimize for size and speed, strip symbols.
    OPT_FLAGS = -Os -s -DNDEBUG
else
    # Development: optimize for build speed, keep debug symbols.
    OPT_FLAGS = -O0 -g
endif

# Windows liblzma support (MinGW typically has this in standard paths).
# If using MSYS2/MinGW, lzma.h should be available via xz package.
WINDOWS_LZMA_CFLAGS =
WINDOWS_LZMA_LDFLAGS = -llzma

# Windows-specific linker flags base.
# Note: -llzma is required for compression_common.c LZMA support, -lcabinet for Cabinet compression.
# -L$(OUT_DIR) ensures linker finds our generated libcabinet.a import library.
LDFLAGS_BASE = -Wl,--gc-sections -L$(OUT_DIR) -lcabinet $(WINDOWS_LZMA_LDFLAGS)

# Windows post-link libraries (must come after LIEF library on linker command line).
# Note: -lws2_32 provides inet_pton for LIEF's mbedtls.
LDFLAGS_POST = -lws2_32

# Cabinet.dll import library generation.
IMPORT_LIB = $(OUT_DIR)/libcabinet.a

$(IMPORT_LIB): ../bin-infra/src/cabinet.def | $(OUT_DIR)
	dlltool -d ../bin-infra/src/cabinet.def -l $@

# Check-tools must include dlltool.
define CHECK_TOOLS_EXTRA
	@command -v dlltool >/dev/null 2>&1 || { echo "ERROR: dlltool not found. Install MinGW binutils."; exit 1; }
endef

# Clean command implementation.
define CLEAN_IMPL
	@echo "Cleaning build artifacts..."
	@find build/dev build/prod -type f -name '*.o' -delete 2>/dev/null || true
	@find build/dev build/prod -type f -name '*.gcda' -delete 2>/dev/null || true
	@find build/dev build/prod -type f -name '*.gcno' -delete 2>/dev/null || true
	@rm -f build/dev/$(1)_test.exe build/prod/$(1)_test.exe 2>/dev/null || true
	@rm -f build/dev/$(1)_test_coverage.exe build/prod/$(1)_test_coverage.exe 2>/dev/null || true
	@rm -rf build/dev/out build/prod/out 2>/dev/null || true
endef

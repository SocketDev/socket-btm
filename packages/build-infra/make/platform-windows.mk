# Windows-specific compiler and flags.
# For ARM64 cross-compilation, use llvm-mingw's aarch64 compiler.
ifdef TARGET_ARCH
    ifeq ($(TARGET_ARCH),arm64)
        CC := aarch64-w64-mingw32-gcc
        CXX := aarch64-w64-mingw32-g++
    else ifeq ($(TARGET_ARCH),aarch64)
        CC := aarch64-w64-mingw32-gcc
        CXX := aarch64-w64-mingw32-g++
    else
        CC ?= gcc
        CXX ?= g++
    endif
else
    CC ?= gcc
    CXX ?= g++
endif

# Build mode flags.
ifeq ($(BUILD_MODE),prod)
    # Production: optimize for size and speed, strip symbols.
    OPT_FLAGS = -Os -s -DNDEBUG
else
    # Development: optimize for build speed, keep debug symbols.
    OPT_FLAGS = -O0 -g
endif

# Windows-specific linker flags base.
# -lcabinet links Windows Cabinet.dll for Cabinet compression.
# -L$(OUT_DIR) ensures linker finds our generated libcabinet.a import library.
LDFLAGS_BASE = -Wl,--gc-sections -L$(OUT_DIR) -lcabinet

# Windows post-link libraries (must come after LIEF library on linker command line).
# Note: -lws2_32 provides inet_pton for LIEF's mbedtls.
LDFLAGS_POST = -lws2_32

# Cabinet.dll import library generation.
IMPORT_LIB = $(OUT_DIR)/libcabinet.a

$(IMPORT_LIB): $(BIN_INFRA_SRC)/cabinet.def | $(OUT_DIR)
	dlltool -d $(BIN_INFRA_SRC)/cabinet.def -l $@

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

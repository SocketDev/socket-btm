# Linux-specific compiler and flags.

CC ?= gcc
CXX ?= g++

# Build mode flags.
ifeq ($(BUILD_MODE),prod)
    # Production: optimize for size and speed.
    # Note: Linux stripping is done post-build with plain strip (no -s flag) to preserve pthread symbols.
    OPT_FLAGS = -Os -DNDEBUG
else
    # Development: optimize for build speed, keep debug symbols.
    OPT_FLAGS = -O0 -g
endif

# Linux-specific linker flags base.
LDFLAGS_BASE = -static -llzma -Wl,--gc-sections

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

# binject Makefile for macOS
# Mach-O binary injection tool

# Build mode: dev (default locally, fast builds) or prod (optimized for size/speed)
# Auto-detects CI environment and defaults accordingly:
# - Local: defaults to dev for fast iteration
# - CI: defaults to prod for optimized releases
ifdef CI
BUILD_MODE ?= prod
else
BUILD_MODE ?= dev
endif

# Build output directory includes mode for proper isolation
BUILD_MODE_DIR = build/$(BUILD_MODE)

# Version info: YYYYMMDD-commit format
BUILD_DATE := $(shell date -u +"%Y%m%d")
BUILD_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
VERSION := $(BUILD_DATE)-$(BUILD_COMMIT)

# Build mode flags
ifeq ($(BUILD_MODE),prod)
    # Production: optimize for size and speed, strip symbols
    # Note: macOS can safely use -s flag for stripping
    OPT_FLAGS = -Os -s -DNDEBUG
else
    # Development: optimize for build speed, keep debug symbols
    OPT_FLAGS = -O0 -g
endif

CC = /usr/bin/clang
CXX = /usr/bin/clang++

# LIEF paths.
LIEF_UPSTREAM = upstream/lief
LIEF_BUILD_DIR = build/lief
LIEF_LIB = $(LIEF_BUILD_DIR)/libLIEF.a
LIEF_INCLUDE_DIR = $(LIEF_UPSTREAM)/include

CFLAGS = -Wall -Wextra $(OPT_FLAGS) -std=c11 -I../bin-infra/src -DVERSION=\"$(VERSION)\" -D_POSIX_C_SOURCE=200809L -D_XOPEN_SOURCE=700
CXXFLAGS = -Wall -Wextra $(OPT_FLAGS) -std=c++17 -I../bin-infra/src -I$(LIEF_INCLUDE_DIR) -I$(LIEF_BUILD_DIR)/include
LDFLAGS = -lcompression -Wl,-dead_strip

# Add LIEF library if it exists (macOS only).
ifneq (,$(wildcard $(LIEF_LIB)))
    LDFLAGS += $(LIEF_LIB)
    CFLAGS += -DHAVE_LIEF=1
    CXXFLAGS += -DHAVE_LIEF=1
endif

TARGET = binject
BUILD_DIR = $(BUILD_MODE_DIR)
BIN_DIR = $(BUILD_MODE_DIR)/out
SRC_DIR = src
TEST_DIR = test

# Source files
SRCS = $(SRC_DIR)/main.c $(SRC_DIR)/binject.c $(SRC_DIR)/stub_repack.c $(SRC_DIR)/macho_inject_lief_wrapper.c $(SRC_DIR)/remove_signature_lib.c $(SRC_DIR)/elf_inject.c $(SRC_DIR)/pe_inject.c ../bin-infra/src/compression_common.c ../bin-infra/src/file_io_common.c
OBJS = $(BUILD_DIR)/main.o $(BUILD_DIR)/binject.o $(BUILD_DIR)/stub_repack.o $(BUILD_DIR)/macho_inject_lief_wrapper.o $(BUILD_DIR)/remove_signature_lib.o $(BUILD_DIR)/elf_inject.o $(BUILD_DIR)/pe_inject.o $(BUILD_DIR)/compression_common.o $(BUILD_DIR)/file_io_common.o

# Add LIEF C++ sources if library exists.
ifneq (,$(wildcard $(LIEF_LIB)))
    SRCS += $(SRC_DIR)/macho_inject_lief.cpp $(SRC_DIR)/macho_compress_segment.cpp $(SRC_DIR)/elf_inject_lief.cpp $(SRC_DIR)/pe_inject_lief.cpp
    OBJS += $(BUILD_DIR)/macho_inject_lief.o $(BUILD_DIR)/macho_compress_segment.o $(BUILD_DIR)/elf_inject_lief.o $(BUILD_DIR)/pe_inject_lief.o
endif

# Test files
TEST_SRCS = $(TEST_DIR)/binject_test.c $(SRC_DIR)/binject.c ../bin-infra/src/compression_common.c
TEST_OBJS = $(BUILD_DIR)/binject_test.o $(BUILD_DIR)/binject.o $(BUILD_DIR)/compression_common.o
TEST_TARGET = $(BUILD_DIR)/binject_test

.PHONY: all clean install uninstall test cover clean-coverage check-tools

# Check that required build tools are available
check-tools:
	@command -v $(CC) >/dev/null 2>&1 || { echo "ERROR: $(CC) not found. Install build tools first."; exit 1; }
	@command -v $(CXX) >/dev/null 2>&1 || { echo "ERROR: $(CXX) not found. Install build tools first."; exit 1; }
	@command -v make >/dev/null 2>&1 || { echo "ERROR: make not found"; exit 1; }

# Default target
all: check-tools $(BIN_DIR)/$(TARGET)

# Create directories
$(BUILD_DIR) $(BIN_DIR):
	@mkdir -p $@

# Build binary (use CXX if LIEF is enabled, otherwise CC).
$(BIN_DIR)/$(TARGET): $(OBJS) | $(BIN_DIR)
ifneq (,$(wildcard $(LIEF_LIB)))
	$(CXX) $(CXXFLAGS) -o $@ $(OBJS) $(LDFLAGS)
else
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LDFLAGS)
endif
	@echo "Built: $(BIN_DIR)/$(TARGET)"
	@# Sign binary with ad-hoc signature on macOS (required for Node.js spawn)
	@codesign -s - $@ 2>/dev/null || true
	@echo "Signed: $(BIN_DIR)/$(TARGET)"

# Compile C files
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Compile C++ files
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

# Compile compression_common from bin-infra
$(BUILD_DIR)/compression_common.o: ../bin-infra/src/compression_common.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Compile file_io_common from bin-infra
$(BUILD_DIR)/file_io_common.o: ../bin-infra/src/file_io_common.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Clean build artifacts (preserve LIEF installation).
clean:
	@echo "Cleaning build artifacts (preserving LIEF)..."
	@find build/dev build/prod -type f -name '*.o' -delete 2>/dev/null || true
	@find build/dev build/prod -type f -name '*.gcda' -delete 2>/dev/null || true
	@find build/dev build/prod -type f -name '*.gcno' -delete 2>/dev/null || true
	@rm -f build/dev/binject_test build/prod/binject_test 2>/dev/null || true
	@rm -f build/dev/binject_test_coverage build/prod/binject_test_coverage 2>/dev/null || true
	@rm -rf build/dev/out build/prod/out 2>/dev/null || true

# Install (optional, for system-wide use)
install: $(BIN_DIR)/$(TARGET)
	install -m 755 $(BIN_DIR)/$(TARGET) /usr/local/bin/

# Uninstall
uninstall:
	rm -f /usr/local/bin/$(TARGET)

# Build test binary
$(TEST_TARGET): $(TEST_OBJS)
	$(CC) $(CFLAGS) -o $@ $(TEST_OBJS) $(LDFLAGS)
	@echo "Built: $(TEST_TARGET)"

# Compile test source
$(BUILD_DIR)/binject_test.o: $(TEST_DIR)/binject_test.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Run tests
test: $(TEST_TARGET)
	@echo "\nRunning binject tests..."
	@$(TEST_TARGET)

# Coverage target - build with coverage instrumentation and generate reports
COVERAGE_DIR = coverage
COVERAGE_CFLAGS = $(CFLAGS) -fprofile-arcs -ftest-coverage -O0 -g
COVERAGE_LDFLAGS = $(LDFLAGS) -fprofile-arcs -ftest-coverage

$(BUILD_DIR)/coverage_%.o: $(SRC_DIR)/%.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/coverage_compression_common.o: ../bin-infra/src/compression_common.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/coverage_binject_test.o: $(TEST_DIR)/binject_test.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/binject_test_coverage: $(BUILD_DIR)/coverage_binject_test.o $(BUILD_DIR)/coverage_binject.o $(BUILD_DIR)/coverage_compression_common.o
	$(CC) $(COVERAGE_CFLAGS) -o $@ $^ $(COVERAGE_LDFLAGS)

cover: $(BUILD_DIR)/binject_test_coverage | $(COVERAGE_DIR)
	@echo "Running tests with coverage..."
	@$(BUILD_DIR)/binject_test_coverage
	@echo "\nGenerating coverage report..."
	@gcov -o $(BUILD_DIR) $(SRC_DIR)/binject.c ../bin-infra/src/compression_common.c
	@mkdir -p $(COVERAGE_DIR)
	@mv *.gcov $(COVERAGE_DIR)/ 2>/dev/null || true
	@echo "\nCoverage Summary:"
	@echo "================="
	@grep -A 3 "File.*binject.c" $(COVERAGE_DIR)/binject.c.gcov | head -4 || echo "binject.c coverage data not found"
	@grep -A 3 "File.*compression_common.c" $(COVERAGE_DIR)/compression_common.c.gcov | head -4 || echo "compression_common.c coverage data not found"
	@echo "\nDetailed reports in $(COVERAGE_DIR)/"

$(COVERAGE_DIR):
	@mkdir -p $@

clean-coverage:
	rm -rf $(COVERAGE_DIR)
	rm -f $(BUILD_DIR)/*.gcda $(BUILD_DIR)/*.gcno
	rm -f *.gcov

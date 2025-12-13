# binpress Makefile for macOS
# Mach-O binary compression tool

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
CFLAGS = -Wall -Wextra $(OPT_FLAGS) -std=c11 -I../bin-infra/src -DVERSION=\"$(VERSION)\"
LDFLAGS = -lcompression -Wl,-dead_strip

BUILD_DIR = $(BUILD_MODE_DIR)
BIN_DIR = $(BUILD_MODE_DIR)/out

TARGET = binpress
SOURCE = src/macho_compress.c
OUT_DIR = $(BIN_DIR)

.PHONY: all clean test check-tools install cover clean-coverage

# Check that required build tools are available
check-tools:
	@command -v $(CC) >/dev/null 2>&1 || { echo "ERROR: $(CC) not found. Install build tools first."; exit 1; }
	@command -v make >/dev/null 2>&1 || { echo "ERROR: make not found"; exit 1; }

all: check-tools $(OUT_DIR)/$(TARGET)

$(OUT_DIR)/$(TARGET): $(SOURCE) | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)
	@echo "Built: $(OUT_DIR)/$(TARGET)"

$(OUT_DIR):
	mkdir -p $@

clean:
	@echo "Cleaning build artifacts..."
	@find build/dev build/prod -type f -name '*.o' -delete 2>/dev/null || true
	@find build/dev build/prod -type f -name '*.gcda' -delete 2>/dev/null || true
	@find build/dev build/prod -type f -name '*.gcno' -delete 2>/dev/null || true
	@rm -f build/dev/binpress_test build/prod/binpress_test 2>/dev/null || true
	@rm -f build/dev/binpress_test_coverage build/prod/binpress_test_coverage 2>/dev/null || true
	@rm -rf build/dev/out build/prod/out 2>/dev/null || true

install: all
	@echo "Compression tool built successfully: $(OUT_DIR)/$(TARGET)"

test: all
	@echo "Running binpress tests..."
	@bash test/test.sh

# Coverage target - build with coverage instrumentation and generate reports
COVERAGE_DIR = coverage
COVERAGE_CFLAGS = $(CFLAGS) -fprofile-arcs -ftest-coverage -O0 -g
COVERAGE_LDFLAGS = $(LDFLAGS) -fprofile-arcs -ftest-coverage
COVERAGE_TARGET = $(OUT_DIR)/$(TARGET)_coverage

$(COVERAGE_TARGET): $(SOURCE) | $(OUT_DIR)
	$(CC) $(COVERAGE_CFLAGS) -o $@ $< $(COVERAGE_LDFLAGS)

cover: $(COVERAGE_TARGET) | $(COVERAGE_DIR)
	@echo "Running compression tests with coverage..."
	@# Create test data
	@mkdir -p $(OUT_DIR)/test_data
	@dd if=/dev/zero of=$(OUT_DIR)/test_data/zeros.bin bs=1024 count=1024 2>/dev/null
	@dd if=/dev/urandom of=$(OUT_DIR)/test_data/random.bin bs=64 count=1 2>/dev/null
	@for i in {1..20}; do echo "Test line $$i with repetitive content for compression testing" >> $(OUT_DIR)/test_data/text.txt; done
	@# Test various compression scenarios
	@echo "Testing compressible file..."
	@$(COVERAGE_TARGET) $(OUT_DIR)/test_data/zeros.bin $(OUT_DIR)/test_data/zeros.bin.compressed > /dev/null 2>&1 || true
	@echo "Testing small incompressible file..."
	@$(COVERAGE_TARGET) $(OUT_DIR)/test_data/random.bin $(OUT_DIR)/test_data/random.bin.compressed > /dev/null 2>&1 || true
	@echo "Testing text file..."
	@$(COVERAGE_TARGET) $(OUT_DIR)/test_data/text.txt $(OUT_DIR)/test_data/text.txt.compressed > /dev/null 2>&1 || true
	@echo "Testing error handling (missing file)..."
	@$(COVERAGE_TARGET) /tmp/nonexistent_file_12345.txt $(OUT_DIR)/test_data/out.compressed > /dev/null 2>&1 || true
	@echo "Testing error handling (invalid args)..."
	@$(COVERAGE_TARGET) > /dev/null 2>&1 || true
	@echo "\nGenerating coverage report..."
	@gcov -o $(OUT_DIR) $(SOURCE)
	@mkdir -p $(COVERAGE_DIR)
	@mv *.gcov $(COVERAGE_DIR)/ 2>/dev/null || true
	@echo "\nCoverage Summary:"
	@echo "================="
	@grep -A 3 "File" $(COVERAGE_DIR)/*.gcov | head -10 || echo "Coverage data not found"
	@echo "\nLine Coverage:"
	@grep "Lines executed" $(COVERAGE_DIR)/*.gcov || echo "No coverage metrics found"
	@echo "\nDetailed reports in $(COVERAGE_DIR)/"
	@rm -rf $(OUT_DIR)/test_data

$(COVERAGE_DIR):
	@mkdir -p $@

clean-coverage:
	rm -rf $(COVERAGE_DIR)
	rm -f $(OUT_DIR)/*.gcda $(OUT_DIR)/*.gcno
	rm -f *.gcov

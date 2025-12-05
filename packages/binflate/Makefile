# Makefile for binflate CLI decompression tool
# Platform-agnostic - detects OS and builds appropriate binary

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
    # macOS - Mach-O decompression with Apple Compression framework
    CC = /usr/bin/clang
    CFLAGS = -Os -s -Wall -Wextra -std=c11 -I../bin-infra/src
    LDFLAGS = -lcompression -Wl,-dead_strip
    SOURCE_CLI = src/macho_extract_cli.c
    TARGET_CLI = binflate
else ifeq ($(UNAME_S),Linux)
    # Linux - ELF decompression with liblzma (static linking)
    CC = gcc
    CFLAGS = -Os -s -Wall -Wextra -std=c11 -I../bin-infra/src
    LDFLAGS = -static -llzma -lssl -lcrypto -ldl -lpthread -Wl,--gc-sections
    SOURCE_CLI = src/elf_extract_cli.c
    TARGET_CLI = binflate
else
    # Windows - PE decompression with Windows Compression API
    # Requires Windows 8+ and Cabinet.dll (linked via generated import library)
    CC = gcc
    CFLAGS = -Os -s -Wall -Wextra -std=c11 -I../bin-infra/src
    LDFLAGS = -Wl,--gc-sections -L$(OUT_DIR) -lcabinet
    SOURCE_CLI = src/pe_extract_cli.c
    TARGET_CLI = binflate.exe
    IMPORT_LIB = $(OUT_DIR)/libcabinet.a
endif

# Output directories
OUT_DIR = out

.PHONY: all clean test check-tools

# Check that required build tools are available
check-tools:
	@command -v $(CC) >/dev/null 2>&1 || { echo "ERROR: $(CC) not found. Install build tools first."; exit 1; }
	@command -v make >/dev/null 2>&1 || { echo "ERROR: make not found"; exit 1; }
ifneq ($(filter-out Darwin Linux,$(UNAME_S)),)
	@command -v dlltool >/dev/null 2>&1 || { echo "ERROR: dlltool not found. Install MinGW binutils."; exit 1; }
endif

# Build CLI extraction tool
# This is the user-facing CLI tool for extracting compressed binaries
all: check-tools $(OUT_DIR)/$(TARGET_CLI)

# Windows: Generate import library from Cabinet.dll (when not Darwin or Linux)
ifneq ($(filter-out Darwin Linux,$(UNAME_S)),)
$(IMPORT_LIB): cabinet.def | $(OUT_DIR)
	dlltool -d cabinet.def -l $@

$(OUT_DIR)/$(TARGET_CLI): $(SOURCE_CLI) $(IMPORT_LIB) | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)
else
# CLI extraction tool (used by end users)
$(OUT_DIR)/$(TARGET_CLI): $(SOURCE_CLI) | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)
endif

$(OUT_DIR):
	mkdir -p $@

clean:
	rm -rf $(OUT_DIR)

install: all
	@echo "Decompression CLI tool built successfully: $(OUT_DIR)/$(TARGET_CLI)"

test: all
	@echo "Running binflate tests..."
	@bash test/test.sh

# Coverage target - build with coverage instrumentation
# Note: binflate creates self-extracting binaries, so coverage is limited
# to what can be tested through the self-extraction process
COVERAGE_DIR = coverage
COVERAGE_CFLAGS = $(CFLAGS) -fprofile-arcs -ftest-coverage -O0 -g
COVERAGE_LDFLAGS = $(LDFLAGS) -fprofile-arcs -ftest-coverage
COVERAGE_TARGET = $(OUT_DIR)/$(TARGET)_coverage

$(COVERAGE_TARGET): $(SOURCE) | $(OUT_DIR)
	$(CC) $(COVERAGE_CFLAGS) -o $@ $< $(COVERAGE_LDFLAGS)

cover: $(COVERAGE_TARGET) | $(COVERAGE_DIR)
	@echo "Running decompression tests with coverage..."
	@echo "Note: Coverage shows decompressor source paths exercised during binary execution"
	@# Run the coverage-instrumented binary (it will execute and self-extract if possible)
	@echo "Executing instrumented binary..."
	@$(COVERAGE_TARGET) || true
	@echo "\nGenerating coverage report..."
	@gcov -o $(OUT_DIR) $(SOURCE)
	@mkdir -p $(COVERAGE_DIR)
	@mv *.gcov $(COVERAGE_DIR)/ 2>/dev/null || true
	@echo "\nCoverage Summary:"
	@echo "================="
	@echo "This shows which code paths in the decompressor are executed."
	@grep -A 3 "File" $(COVERAGE_DIR)/*.gcov | head -10 || echo "Coverage data not found"
	@echo "\nLine Coverage:"
	@grep "Lines executed" $(COVERAGE_DIR)/*.gcov || echo "No coverage metrics found"
	@echo "\nDetailed reports in $(COVERAGE_DIR)/"

$(COVERAGE_DIR):
	@mkdir -p $@

clean-coverage:
	rm -rf $(COVERAGE_DIR)
	rm -f $(OUT_DIR)/*.gcda $(OUT_DIR)/*.gcno
	rm -f *.gcov

.PHONY: clean-coverage cover

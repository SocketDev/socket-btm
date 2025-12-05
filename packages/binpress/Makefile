# Makefile for binpress compression tools
# Platform-agnostic - detects OS and builds appropriate binary

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
    # macOS - Mach-O compression with Apple Compression framework
    CC = /usr/bin/clang
    CFLAGS = -Os -s -Wall -Wextra -std=c11 -I../bin-infra/src
    LDFLAGS = -lcompression -Wl,-dead_strip
    SOURCE = src/macho_compress.c
    TARGET = binpress
else ifeq ($(UNAME_S),Linux)
    # Linux - ELF compression with liblzma
    CC = gcc
    CFLAGS = -Os -s -Wall -Wextra -std=c11 -I../bin-infra/src
    LDFLAGS = -llzma -Wl,--gc-sections
    SOURCE = src/elf_compress.c
    TARGET = binpress
else
    # Windows - PE compression with Windows Compression API
    # Requires Windows 8+ and Cabinet.dll (linked via generated import library)
    CC = gcc
    CFLAGS = -Os -s -Wall -Wextra -std=c11 -I../bin-infra/src
    LDFLAGS = -Wl,--gc-sections -L$(OUT_DIR) -lcabinet
    SOURCE = src/pe_compress.c
    TARGET = binpress.exe
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

all: check-tools $(OUT_DIR)/$(TARGET)

# Windows: Generate import library from Cabinet.dll (when not Darwin or Linux)
ifneq ($(filter-out Darwin Linux,$(UNAME_S)),)
$(IMPORT_LIB): cabinet.def | $(OUT_DIR)
	dlltool -d cabinet.def -l $@

$(OUT_DIR)/$(TARGET): $(SOURCE) $(IMPORT_LIB) | $(OUT_DIR)
	@echo "DEBUG: Building $@ from $<"
	@echo "DEBUG: LDFLAGS = $(LDFLAGS)"
	@echo "DEBUG: Import lib exists:" && ls -la $(IMPORT_LIB) || echo "NOT FOUND"
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)
	@echo "DEBUG: GCC exit code: $$?"
	@echo "DEBUG: Directory contents:" && ls -la $(OUT_DIR) || echo "DIR NOT FOUND"
	@test -f $@ && echo "DEBUG: Binary created successfully" || (echo "ERROR: Binary NOT created at $@" && exit 1)
else
$(OUT_DIR)/$(TARGET): $(SOURCE) | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)
endif

$(OUT_DIR):
	mkdir -p $@

clean:
	rm -rf $(OUT_DIR)

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

.PHONY: clean-coverage cover

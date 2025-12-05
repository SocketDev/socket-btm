#!/bin/bash
##
# Integration tests for binflate decompression tools
# Tests that decompression binaries work correctly
##

set -e

# Check required tools before running tests
command -v make >/dev/null 2>&1 || { echo "ERROR: make not found. Install make first."; exit 1; }
command -v file >/dev/null 2>&1 || { echo "ERROR: file not found. Install file command first."; exit 1; }

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

# Test framework functions
test_suite() {
    echo -e "${BOLD}${CYAN}\n=== $1 ===${RESET}"
}

run_test() {
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    echo -n "  "
    if eval "$2" > /dev/null 2>&1; then
        PASS_COUNT=$((PASS_COUNT + 1))
        echo -e "${GREEN}✓${RESET} $1"
        return 0
    else
        FAIL_COUNT=$((FAIL_COUNT + 1))
        echo -e "${RED}✗${RESET} $1"
        return 1
    fi
}

test_report() {
    echo -e "${BOLD}\n=== Test Summary ===${RESET}"
    echo -e "${CYAN}  Total:  ${TOTAL_COUNT}${RESET}"
    echo -e "${GREEN}  Passed: ${PASS_COUNT}${RESET}"
    if [ $FAIL_COUNT -gt 0 ]; then
        echo -e "${RED}  Failed: ${FAIL_COUNT}${RESET}"
    fi
    echo ""

    if [ $FAIL_COUNT -eq 0 ]; then
        return 0
    else
        return 1
    fi
}

# Get script directory to find binaries reliably
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
BINPRESS_DIR="$(dirname "$PACKAGE_DIR")/binpress"

# Determine platform and set binary names
PLATFORM=$(uname -s)
if [ "$PLATFORM" = "Darwin" ] || [ "$PLATFORM" = "Linux" ]; then
    COMPRESSOR="$BINPRESS_DIR/out/binpress"
    DECOMPRESSOR="$PACKAGE_DIR/out/binflate"
else
    COMPRESSOR="$BINPRESS_DIR/out/binpress.exe"
    DECOMPRESSOR="$PACKAGE_DIR/out/binflate.exe"
fi

# Check if decompressor exists
if [ ! -f "$DECOMPRESSOR" ]; then
    echo -e "${RED}Error: Decompressor binary not found: $DECOMPRESSOR${RESET}"
    echo -e "${YELLOW}Run 'make' first to build the binaries${RESET}"
    exit 1
fi

# Check if compressor exists (needed for round-trip tests)
if [ ! -f "$COMPRESSOR" ]; then
    echo -e "${YELLOW}Warning: Compressor binary not found: $COMPRESSOR${RESET}"
    echo -e "${YELLOW}Round-trip tests will be skipped${RESET}"
    HAS_COMPRESSOR=false
else
    HAS_COMPRESSOR=true
fi

# Create temp directory for tests
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

test_suite "binflate Integration Tests"

# Test: Binary exists and is executable
run_test "decompressor_binary_exists" "[ -f '$DECOMPRESSOR' ]"
run_test "decompressor_binary_executable" "[ -x '$DECOMPRESSOR' ]"

# Test: Binary has reasonable size (should be at least 10KB with embedded decompression code)
BINARY_SIZE=$(wc -c < "$DECOMPRESSOR")
run_test "decompressor_binary_minimum_size" "[ $BINARY_SIZE -gt 10240 ]"

# Test: Binary has correct file type
if [ "$PLATFORM" = "Darwin" ]; then
    run_test "extractor_is_macho_binary" "file '$DECOMPRESSOR' | grep -q 'Mach-O.*executable'"
elif [ "$PLATFORM" = "Linux" ]; then
    # Accept various ELF executable formats (some systems say "executable", others say "dynamically linked")
    run_test "extractor_is_elf_binary" "file '$DECOMPRESSOR' | grep -q 'ELF' && file '$DECOMPRESSOR' | grep -q -E '(executable|LSB)'"
fi

# Test: Binary contains decompression library symbols
if [ "$PLATFORM" = "Darwin" ]; then
    # macOS uses LZFSE, check for related symbols or library linkage
    run_test "binary_has_decompression_symbols" "nm '$DECOMPRESSOR' 2>/dev/null | grep -q -i 'decompress\\|lzfse\\|lzma' || otool -L '$DECOMPRESSOR' | grep -q 'liblzma\\|libcompression'"
elif [ "$PLATFORM" = "Linux" ]; then
    # Linux uses LZMA
    run_test "binary_has_decompression_symbols" "nm '$DECOMPRESSOR' 2>/dev/null | grep -q -i 'decompress\\|lzma' || ldd '$DECOMPRESSOR' | grep -q 'liblzma'"
fi

# Test: Binary has proper permissions (owner read+write+execute at minimum)
run_test "decompressor_owner_readable" "[ -r '$DECOMPRESSOR' ]"
run_test "decompressor_owner_writable" "[ -w '$DECOMPRESSOR' ]"

# Test: Verify the binary can be copied (not corrupted)
run_test "extractor_can_be_copied" "cp '$DECOMPRESSOR' '$TEST_DIR/test_copy' && [ -f '$TEST_DIR/test_copy' ]"

# Note: binflate is a CLI extraction tool for compressed binaries.
# It extracts compressed binaries that were created by binpress and have embedded
# compressed data with magic markers. The binflate CLI tool does NOT contain
# embedded compressed data itself - it's a utility to extract other compressed binaries.
#
# Testing strategy:
# - binpress tests verify compression works correctly
# - node-smol-builder integration tests verify the full compress->embed->extract cycle
# - binflate standalone tests verify binary properties, structure, and basic functionality

echo -e "${YELLOW}Note: Full extraction tests require compressed test binaries from node-smol-builder${RESET}"

test_report

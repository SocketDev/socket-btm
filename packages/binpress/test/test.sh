#!/bin/bash
##
# Integration tests for binpress compression tools
# Tests that compression binaries work correctly
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

# Determine build mode and platform
BUILD_MODE=${BUILD_MODE:-dev}
if [ -n "$CI" ]; then
    BUILD_MODE="prod"
fi
PLATFORM=$(uname -s)
if [ "$PLATFORM" = "Darwin" ] || [ "$PLATFORM" = "Linux" ]; then
    COMPRESSOR="$PACKAGE_DIR/build/$BUILD_MODE/out/binpress"
else
    COMPRESSOR="$PACKAGE_DIR/build/$BUILD_MODE/out/binpress.exe"
fi

# Check if compressor exists
if [ ! -f "$COMPRESSOR" ]; then
    echo -e "${RED}Error: Compressor binary not found: $COMPRESSOR${RESET}"
    echo -e "${YELLOW}Run 'make' first to build the binaries${RESET}"
    exit 1
fi

# Create temp directory for tests
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

test_suite "binpress Integration Tests"

# Test: Binary exists and is executable
run_test "compressor_binary_exists" "[ -f '$COMPRESSOR' ]"
run_test "compressor_binary_executable" "[ -x '$COMPRESSOR' ]"

# Test: Create test file with enough content to compress well
# Repeat text to create a larger file that will compress better
for i in {1..20}; do
    echo "Hello, binpress! This is a test file for compression. Line $i." >> "$TEST_DIR/test.txt"
done
run_test "create_test_file" "[ -f '$TEST_DIR/test.txt' ]"

# Test: Compress file (basic)
run_test "compress_basic" "$COMPRESSOR '$TEST_DIR/test.txt' --data-only -o '$TEST_DIR/test.txt.compressed'"

# Test: Compressed file exists
run_test "compressed_file_exists" "[ -f '$TEST_DIR/test.txt.compressed' ]"

# Test: Compressed file is smaller (with enough repetitive text, should compress well)
ORIGINAL_SIZE=$(wc -c < "$TEST_DIR/test.txt")
COMPRESSED_SIZE=$(wc -c < "$TEST_DIR/test.txt.compressed")
run_test "compressed_file_smaller" "[ $COMPRESSED_SIZE -lt $ORIGINAL_SIZE ]"

# Test: Create larger test file (1MB)
dd if=/dev/zero of="$TEST_DIR/large.bin" bs=1024 count=1024 2>/dev/null
run_test "create_large_file" "[ -f '$TEST_DIR/large.bin' ]"

# Test: Compress large file
run_test "compress_large_file" "$COMPRESSOR '$TEST_DIR/large.bin' --data-only -o '$TEST_DIR/large.bin.compressed'"

# Test: Large compressed file exists
run_test "large_compressed_file_exists" "[ -f '$TEST_DIR/large.bin.compressed' ]"

# Test: Large file compressed significantly (zeros compress very well)
LARGE_ORIGINAL=$(wc -c < "$TEST_DIR/large.bin")
LARGE_COMPRESSED=$(wc -c < "$TEST_DIR/large.bin.compressed")
run_test "large_file_well_compressed" "[ $LARGE_COMPRESSED -lt $((LARGE_ORIGINAL / 10)) ]"

# Test: Error handling - missing input file
run_test "error_missing_input" "! $COMPRESSOR '/tmp/nonexistent_file_12345.txt' --data-only -o '$TEST_DIR/out.compressed' 2>/dev/null"

# Test: Error handling - invalid arguments (too few)
run_test "error_invalid_args" "! $COMPRESSOR 2>/dev/null"

# Test: Compression of small incompressible file
# Create a small file with random data (incompressible)
dd if=/dev/urandom of="$TEST_DIR/small_random.bin" bs=64 count=1 2>/dev/null
run_test "create_small_random_file" "[ -f '$TEST_DIR/small_random.bin' ]"

# Compress the small random file (will have overhead for incompressible data)
$COMPRESSOR "$TEST_DIR/small_random.bin" --data-only -o "$TEST_DIR/small_random.bin.compressed" > /dev/null 2>&1
run_test "compress_small_incompressible" "[ -f '$TEST_DIR/small_random.bin.compressed' ]"

# Note: Small incompressible files may be larger after compression due to
# compression format overhead (headers, metadata). This is expected behavior.
# binpress does not implement overhead detection to fall back to uncompressed.

test_report

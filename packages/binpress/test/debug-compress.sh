#!/bin/bash
##
# Debug script for binpress compression failures.
# Runs binpress with verbose output to diagnose issues.
##

set -e

# Find binpress binary.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Detect platform and build mode.
if [ "$BUILD_MODE" == "prod" ]; then
    BUILD_DIR="$PACKAGE_DIR/build/prod"
else
    BUILD_DIR="$PACKAGE_DIR/build/dev"
fi

# Find the compressor binary.
if [ -f "$BUILD_DIR/out/Final/binpress.exe" ]; then
    COMPRESSOR="$BUILD_DIR/out/Final/binpress.exe"
elif [ -f "$BUILD_DIR/out/Final/binpress" ]; then
    COMPRESSOR="$BUILD_DIR/out/Final/binpress"
else
    echo "ERROR: binpress binary not found in $BUILD_DIR/out/Final/"
    exit 1
fi

echo "Using binpress: $COMPRESSOR"
echo ""

# Create test directory.
TEST_DIR=$(mktemp -d)
trap "rm -rf '$TEST_DIR'" EXIT

# Create test file.
echo "Creating test file..."
for i in {1..20}; do
    echo "Hello, binpress! This is a test file for compression. Line $i." >> "$TEST_DIR/test.txt"
done
echo "Test file created: $TEST_DIR/test.txt"
echo "Test file size: $(wc -c < "$TEST_DIR/test.txt") bytes"
echo ""

# Try to compress with full output.
echo "Running binpress compression..."
echo "Command: $COMPRESSOR '$TEST_DIR/test.txt' -d '$TEST_DIR/test.txt.compressed'"
echo ""

"$COMPRESSOR" "$TEST_DIR/test.txt" -d "$TEST_DIR/test.txt.compressed"
exit_code=$?

echo ""
echo "Exit code: $exit_code"

if [ $exit_code -eq 0 ]; then
    echo "SUCCESS: Compression completed"
    echo "Output file: $TEST_DIR/test.txt.compressed"
    echo "Output size: $(wc -c < "$TEST_DIR/test.txt.compressed") bytes"
else
    echo "FAILURE: Compression failed"
fi

exit $exit_code

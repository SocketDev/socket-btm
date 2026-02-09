#!/bin/bash
# Test script for LIEF integration in binject.
# Verifies that LIEF can inject multiple sections into the same segment.

set -e

echo "🧪 Testing LIEF integration with binject"
echo "========================================"
echo ""

# Check if we're on macOS.
if [[ "$(uname)" != "Darwin" ]]; then
    echo "⚠️  Skipping LIEF tests (not on macOS)"
    exit 0
fi

# Build LIEF first.
echo "1. Building LIEF..."
cd "$(dirname "$0")/.."
pnpm run build:lief

# Check if LIEF was built.
if [[ ! -f "build/lief-install/lib/libLIEF.a" ]]; then
    echo "❌ LIEF library not found"
    exit 1
fi
echo "✅ LIEF library built successfully"
echo ""

# Build binject with LIEF.
echo "2. Building binject with LIEF..."
pnpm run build
echo "✅ binject built successfully"
echo ""

# Create a test binary with sentinel.
echo "3. Creating test binary..."
cat > /tmp/binject-test.c << 'EOF'
static const volatile char sentinel[] = "POSTJECT_SENTINEL_fce680ab2cc467b6e072b8b5df1996b2:0";

int main() {
    return sentinel[0] == 'P' ? 0 : 1;
}
EOF

xcrun clang -o /tmp/binject-test /tmp/binject-test.c
echo "✅ Test binary created"
echo ""

# Test 1: Single section injection with LIEF.
echo "4. Testing single section injection..."
echo "test data for section 1" > /tmp/test-data1.bin

./out/binject inject /tmp/binject-test NODE_SEA __TEST_SECTION1 /tmp/test-data1.bin

# Verify section was added.
if otool -l /tmp/binject-test | grep -q "__TEST_SECTION1"; then
    echo "✅ Section __TEST_SECTION1 added successfully"
else
    echo "❌ Section __TEST_SECTION1 not found"
    exit 1
fi
echo ""

# Test 2: Add second section to same segment.
echo "5. Testing second section injection into same segment..."
echo "test data for section 2" > /tmp/test-data2.bin

./out/binject inject /tmp/binject-test NODE_SEA __TEST_SECTION2 /tmp/test-data2.bin

# Verify both sections exist.
if otool -l /tmp/binject-test | grep -q "__TEST_SECTION1"; then
    echo "✅ Section __TEST_SECTION1 still present"
else
    echo "❌ Section __TEST_SECTION1 missing after second injection"
    exit 1
fi

if otool -l /tmp/binject-test | grep -q "__TEST_SECTION2"; then
    echo "✅ Section __TEST_SECTION2 added successfully"
else
    echo "❌ Section __TEST_SECTION2 not found"
    exit 1
fi
echo ""

# Test 3: Verify segment structure.
echo "6. Verifying segment structure..."
SEGMENT_INFO=$(otool -l /tmp/binject-test | grep -A 30 "segname NODE_SEA")

NSECTS=$(echo "$SEGMENT_INFO" | grep "nsects" | awk '{print $2}')
if [[ "$NSECTS" == "2" ]]; then
    echo "✅ NODE_SEA segment has 2 sections"
else
    echo "❌ NODE_SEA segment has $NSECTS sections (expected 2)"
    exit 1
fi
echo ""

# Test 4: Verify data integrity.
echo "7. Verifying data integrity..."

# Get file offsets from otool.
SECTION1_OFFSET=$(echo "$SEGMENT_INFO" | grep -A 8 "__TEST_SECTION1" | grep "offset" | awk '{print $2}')
SECTION2_OFFSET=$(echo "$SEGMENT_INFO" | grep -A 8 "__TEST_SECTION2" | grep "offset" | awk '{print $2}')

# Read data from binary.
SECTION1_DATA=$(xxd -s $SECTION1_OFFSET -l 24 -p /tmp/binject-test | tr -d '\n')
SECTION2_DATA=$(xxd -s $SECTION2_OFFSET -l 24 -p /tmp/binject-test | tr -d '\n')

# Compare with expected data.
EXPECTED1=$(echo -n "test data for section 1" | xxd -p | tr -d '\n')
EXPECTED2=$(echo -n "test data for section 2" | xxd -p | tr -d '\n')

if [[ "$SECTION1_DATA" == "$EXPECTED1" ]]; then
    echo "✅ Section 1 data matches expected content"
else
    echo "❌ Section 1 data mismatch"
    echo "   Expected: $EXPECTED1"
    echo "   Got:      $SECTION1_DATA"
    exit 1
fi

if [[ "$SECTION2_DATA" == "$EXPECTED2" ]]; then
    echo "✅ Section 2 data matches expected content"
else
    echo "❌ Section 2 data mismatch"
    echo "   Expected: $EXPECTED2"
    echo "   Got:      $SECTION2_DATA"
    exit 1
fi
echo ""

# Cleanup.
rm -f /tmp/binject-test /tmp/binject-test.c /tmp/test-data1.bin /tmp/test-data2.bin

echo "=========================================="
echo "✅ All LIEF integration tests passed!"
echo "=========================================="

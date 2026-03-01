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

# Test 1: SEA injection with LIEF.
echo "4. Testing SEA injection..."
echo "test data for SEA blob" > /tmp/test-data1.bin

./out/binject inject -e /tmp/binject-test -o /tmp/binject-test --sea /tmp/test-data1.bin

# Verify NODE_SEA segment was added.
if otool -l /tmp/binject-test | grep -q "__NODE_SEA"; then
    echo "✅ NODE_SEA segment added successfully"
else
    echo "❌ NODE_SEA segment not found"
    exit 1
fi
echo ""

# Test 2: VFS injection (requires SEA).
echo "5. Testing VFS injection with SEA..."
echo "test data for VFS archive" > /tmp/test-data2.vfs

./out/binject inject -e /tmp/binject-test -o /tmp/binject-test --sea /tmp/test-data1.bin --vfs /tmp/test-data2.vfs

# Verify both NODE_SEA and SMOL_VFS segments exist.
if otool -l /tmp/binject-test | grep -q "__NODE_SEA"; then
    echo "✅ NODE_SEA segment still present"
else
    echo "❌ NODE_SEA segment missing after VFS injection"
    exit 1
fi

if otool -l /tmp/binject-test | grep -q "__SMOL_VFS"; then
    echo "✅ SMOL_VFS segment added successfully"
else
    echo "❌ SMOL_VFS segment not found"
    exit 1
fi
echo ""

# Test 3: Verify segment structure.
echo "6. Verifying segment structure..."
NODE_SEA_SEGMENT=$(otool -l /tmp/binject-test | grep -A 10 "segname __NODE_SEA")
SMOL_VFS_SEGMENT=$(otool -l /tmp/binject-test | grep -A 10 "segname __SMOL_VFS")

if [[ -n "$NODE_SEA_SEGMENT" ]] && [[ -n "$SMOL_VFS_SEGMENT" ]]; then
    echo "✅ Both segments present in binary"
else
    echo "❌ Missing segments"
    exit 1
fi
echo ""

# Test 4: Extract and verify data integrity.
echo "7. Verifying data integrity..."

# Extract SEA blob
./out/binject extract -e /tmp/binject-test -o /tmp/extracted-sea.bin --sea

# Extract VFS archive
./out/binject extract -e /tmp/binject-test -o /tmp/extracted-vfs.vfs --vfs

# Compare SEA data
EXTRACTED_SEA=$(cat /tmp/extracted-sea.bin)
EXPECTED_SEA=$(cat /tmp/test-data1.bin)

if [[ "$EXTRACTED_SEA" == "$EXPECTED_SEA" ]]; then
    echo "✅ SEA blob data matches expected content"
else
    echo "❌ SEA blob data mismatch"
    echo "   Expected: $EXPECTED_SEA"
    echo "   Got:      $EXTRACTED_SEA"
    exit 1
fi

# Compare VFS data
EXTRACTED_VFS=$(cat /tmp/extracted-vfs.vfs)
EXPECTED_VFS=$(cat /tmp/test-data2.vfs)

if [[ "$EXTRACTED_VFS" == "$EXPECTED_VFS" ]]; then
    echo "✅ VFS archive data matches expected content"
else
    echo "❌ VFS archive data mismatch"
    echo "   Expected: $EXPECTED_VFS"
    echo "   Got:      $EXTRACTED_VFS"
    exit 1
fi
echo ""

# Cleanup.
rm -f /tmp/binject-test /tmp/binject-test.c /tmp/test-data1.bin /tmp/test-data2.vfs /tmp/extracted-sea.bin /tmp/extracted-vfs.vfs

echo "=========================================="
echo "✅ All LIEF integration tests passed!"
echo "=========================================="

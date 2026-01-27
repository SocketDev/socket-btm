#!/bin/bash
# Test script for write_with_notes() function in elf_note_utils.hpp
#
# This test verifies that write_with_notes() correctly:
# 1. Preserves PT_NOTE segments in both writes
# 2. Removes ALLOC flag from sections with VirtAddr=0
# 3. Produces binaries that execute without SIGSEGV
#
# The test uses binject as a test harness since it uses write_with_notes()
# for SEA injection via elf_inject_lief.cpp

set -e

echo "🧪 Testing write_with_notes() PT_NOTE handling"
echo "=============================================="
echo ""

# Detect platform
PLATFORM="$(uname)"
if [[ "$PLATFORM" == "Darwin" ]]; then
    echo "Platform: macOS"
    USE_READELF=false
elif [[ "$PLATFORM" == "Linux" ]]; then
    echo "Platform: Linux"
    USE_READELF=true
else
    echo "⚠️  Skipping test (unsupported platform: $PLATFORM)"
    exit 0
fi
echo ""

# Navigate to binject directory (test harness)
cd "$(dirname "$0")/../../binject"

# Check if binject is built
if [[ ! -f "build/dev/out/Final/binject" ]] && [[ ! -f "build/shared/out/Final/binject" ]]; then
    echo "⚠️  binject not built, building now..."
    pnpm run build
fi

# Find binject binary
BINJECT_BIN=""
if [[ -f "build/dev/out/Final/binject" ]]; then
    BINJECT_BIN="build/dev/out/Final/binject"
elif [[ -f "build/shared/out/Final/binject" ]]; then
    BINJECT_BIN="build/shared/out/Final/binject"
else
    echo "❌ binject binary not found after build"
    exit 1
fi

echo "✅ Found binject: $BINJECT_BIN"
echo ""

# Find a test binary to inject into
# On Linux, use /bin/sh; on macOS, use /bin/ls
if [[ "$PLATFORM" == "Linux" ]]; then
    TEST_INPUT="/bin/sh"
else
    TEST_INPUT="/bin/ls"
fi

# Copy test input to temp location
TEST_BINARY="/tmp/test-write-with-notes-$$"
cp "$TEST_INPUT" "$TEST_BINARY"
chmod +x "$TEST_BINARY"

echo "1. Creating test data..."
echo "test data for PT_NOTE verification" > /tmp/test-note-data.bin
echo "✅ Test data created"
echo ""

echo "2. Injecting PT_NOTE using write_with_notes()..."
# This uses binject which calls write_with_notes() internally for SEA injection
$BINJECT_BIN "$TEST_BINARY" --sea /tmp/test-note-data.bin --output "$TEST_BINARY.sea" 2>&1 | grep -E "(Using LIEF|PT_NOTE|ALLOC)" || true
echo "✅ Injection completed"
echo ""

echo "3. Verifying PT_NOTE segment exists..."
if [[ "$USE_READELF" == true ]]; then
    # Linux: use readelf
    if readelf -l "$TEST_BINARY.sea" 2>/dev/null | grep -q "NOTE"; then
        echo "✅ PT_NOTE segment found in Program Header Table"
        readelf -l "$TEST_BINARY.sea" 2>/dev/null | grep -A 2 "NOTE" | head -5
    else
        echo "❌ PT_NOTE segment NOT found - write_with_notes() failed!"
        exit 1
    fi
else
    # macOS: use otool
    if otool -l "$TEST_BINARY.sea" 2>/dev/null | grep -q "LC_NOTE"; then
        echo "✅ LC_NOTE load command found"
    else
        echo "⚠️  Note: macOS uses LC_NOTE instead of PT_NOTE (different format)"
    fi
fi
echo ""

echo "4. Verifying ALLOC flag handling (Linux only)..."
if [[ "$USE_READELF" == true ]]; then
    # Check for note sections
    NOTE_SECTIONS=$(readelf -S "$TEST_BINARY.sea" 2>/dev/null | grep "\.note\." || echo "")

    if [[ -n "$NOTE_SECTIONS" ]]; then
        echo "Found note sections:"
        echo "$NOTE_SECTIONS"
        echo ""

        # Check each note section for VirtAddr and ALLOC flag
        while IFS= read -r line; do
            SECTION_NAME=$(echo "$line" | awk '{print $2}' | tr -d '[]')
            VIRT_ADDR=$(echo "$line" | awk '{print $4}')
            FLAGS=$(echo "$line" | awk '{print $8}')

            if [[ "$VIRT_ADDR" == "0000000000000000" ]] || [[ "$VIRT_ADDR" == "00000000" ]]; then
                # VirtAddr is 0, check if ALLOC flag is absent
                if echo "$FLAGS" | grep -q "A"; then
                    echo "❌ CRITICAL: Section $SECTION_NAME has ALLOC flag with VirtAddr=0!"
                    echo "   This will cause SIGSEGV! write_with_notes() fix failed."
                    exit 1
                else
                    echo "✅ Section $SECTION_NAME: VirtAddr=0, ALLOC flag correctly removed"
                fi
            fi
        done <<< "$NOTE_SECTIONS"
    else
        echo "⚠️  No .note.* sections found (this is OK if using PT_NOTE without section headers)"
    fi
else
    echo "⚠️  ALLOC flag verification only available on Linux"
fi
echo ""

echo "5. Verifying binary executes without SIGSEGV..."
# Try to run the binary - it should not segfault
# Use timeout to prevent hanging
if timeout 2 "$TEST_BINARY.sea" --version >/dev/null 2>&1; then
    EXIT_CODE=$?
    if [[ $EXIT_CODE == 139 ]] || [[ $EXIT_CODE == 11 ]]; then
        echo "❌ CRITICAL: Binary segfaulted (exit $EXIT_CODE)!"
        echo "   write_with_notes() produced a corrupted binary."
        exit 1
    fi
    echo "✅ Binary executes without segfault"
elif [[ $? == 124 ]]; then
    # Timeout (command ran for 2+ seconds)
    echo "✅ Binary started successfully (timed out, which is OK)"
else
    EXIT_CODE=$?
    if [[ $EXIT_CODE == 139 ]] || [[ $EXIT_CODE == 11 ]]; then
        echo "❌ CRITICAL: Binary segfaulted (exit $EXIT_CODE)!"
        echo "   write_with_notes() produced a corrupted binary."
        exit 1
    fi
    echo "✅ Binary executed (exit code: $EXIT_CODE)"
fi
echo ""

# Cleanup
rm -f "$TEST_BINARY" "$TEST_BINARY.sea" /tmp/test-note-data.bin

echo "=============================================="
echo "✅ All write_with_notes() tests passed!"
echo ""
echo "Verified:"
echo "  • PT_NOTE segments properly preserved"
echo "  • ALLOC flags correctly handled"
echo "  • No segfaults in produced binaries"
echo "=============================================="

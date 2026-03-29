#!/bin/bash
# Test script for enhanced consistency checker
# Demonstrates auto-fix and ML-powered suggestions

set -e

echo "==================================================================="
echo "Testing Enhanced Consistency Checker"
echo "==================================================================="

# Create a temporary test package
TEST_PKG="packages/test-pkg-temp"
mkdir -p "$TEST_PKG"

# Create a package.json with intentional issues
cat > "$TEST_PKG/package.json" << 'EOF'
{
  "name": "test-pkg-temp",
  "version": "0.0.1",
  "description": "Temporary test package",
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {}
}
EOF

echo ""
echo "1. Created test package with issues:"
echo "   - Missing 'license' field"
echo "   - Missing 'private' field"
echo "   - Missing 'clean' script"
echo ""

# Test 1: Check without fixing
echo "==================================================================="
echo "Test 1: Check mode (no fixes)"
echo "==================================================================="
node scripts/check-consistency.mjs | grep -A 5 "test-pkg-temp" || echo "No test-pkg-temp issues shown (expected if checks don't cover this)"

# Test 2: Dry-run mode
echo ""
echo "==================================================================="
echo "Test 2: Dry-run mode (show what would be fixed)"
echo "==================================================================="
node scripts/check-consistency.mjs --dry-run | tail -20

# Test 3: Auto-fix mode
echo ""
echo "==================================================================="
echo "Test 3: Auto-fix mode (apply fixes)"
echo "==================================================================="
node scripts/check-consistency.mjs --fix | tail -20

# Show the fixed package.json
echo ""
echo "==================================================================="
echo "Test 4: Verify fixes applied"
echo "==================================================================="
if [ -f "$TEST_PKG/package.json" ]; then
  echo "Fixed package.json:"
  cat "$TEST_PKG/package.json"
else
  echo "Test package not found"
fi

# Test 5: ML-powered suggestions
echo ""
echo "==================================================================="
echo "Test 5: ML-powered suggestions"
echo "==================================================================="
node scripts/check-consistency.mjs --suggest | grep -A 30 "ML-Powered Suggestions" || echo "No suggestions found"

# Cleanup
echo ""
echo "==================================================================="
echo "Cleanup"
echo "==================================================================="
rm -rf "$TEST_PKG"
echo "Removed test package"

echo ""
echo "==================================================================="
echo "All tests completed!"
echo "==================================================================="

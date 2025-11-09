#!/bin/bash
# Local testing script for Phase 0 caching fixes

set -e

echo "=========================================="
echo "Phase 0 Caching Fixes - Local Testing"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function for test results
pass() {
  echo -e "${GREEN}✓${NC} $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

echo "Test 1: Verify NODE_VERSION in cache keys"
echo "==========================================="

NODE_VERSION_COUNT=$(grep -c "v\${{ env.NODE_VERSION }}" .github/workflows/release.yml || true)
if [ "$NODE_VERSION_COUNT" -ge 7 ]; then
  pass "Found $NODE_VERSION_COUNT NODE_VERSION references in cache keys (expected >= 7)"
else
  fail "Found only $NODE_VERSION_COUNT NODE_VERSION references (expected >= 7)"
fi

# Check specific cache layers
echo ""
echo "Checking individual cache layers..."

if grep -q "key: build-.*-v\${{ env.NODE_VERSION }}" .github/workflows/release.yml; then
  pass "ccache key includes NODE_VERSION"
else
  fail "ccache key missing NODE_VERSION"
fi

if grep -q "key: node-source-\${{ env.NODE_VERSION }}" .github/workflows/release.yml; then
  pass "node-source cache key includes NODE_VERSION"
else
  fail "node-source cache key missing NODE_VERSION"
fi

if grep -q "key: node-smol-release-.*-v\${{ env.NODE_VERSION }}" .github/workflows/release.yml; then
  pass "Release binary cache key includes NODE_VERSION"
else
  fail "Release binary cache key missing NODE_VERSION"
fi

if grep -q "key: node-smol-stripped-.*-v\${{ env.NODE_VERSION }}" .github/workflows/release.yml; then
  pass "Stripped binary cache key includes NODE_VERSION"
else
  fail "Stripped binary cache key missing NODE_VERSION"
fi

if grep -q "key: node-smol-compressed-.*-v\${{ env.NODE_VERSION }}" .github/workflows/release.yml; then
  pass "Compressed binary cache key includes NODE_VERSION"
else
  fail "Compressed binary cache key missing NODE_VERSION"
fi

if grep -q "key: node-smol-final-.*-v\${{ env.NODE_VERSION }}" .github/workflows/release.yml; then
  pass "Final binary cache key includes NODE_VERSION"
else
  fail "Final binary cache key missing NODE_VERSION"
fi

if grep -q "key: node-smol-checkpoints-.*-v\${{ env.NODE_VERSION }}" .github/workflows/release.yml; then
  pass "Checkpoints cache key includes NODE_VERSION"
else
  fail "Checkpoints cache key missing NODE_VERSION"
fi

echo ""
echo "Test 2: Verify USE_CACHE flag"
echo "==========================================="

if grep -q "USE_CACHE: \${{ vars.USE_CACHE != 'false' }}" .github/workflows/release.yml; then
  pass "USE_CACHE environment variable defined"
else
  fail "USE_CACHE environment variable missing"
fi

USE_CACHE_COUNT=$(grep -c "env.USE_CACHE == 'true'" .github/workflows/release.yml || true)
if [ "$USE_CACHE_COUNT" -ge 7 ]; then
  pass "Found $USE_CACHE_COUNT USE_CACHE checks (expected >= 7)"
else
  fail "Found only $USE_CACHE_COUNT USE_CACHE checks (expected >= 7)"
fi

echo ""
echo "Checking cache steps have USE_CACHE flag..."

if grep -A5 "name: Setup ccache" .github/workflows/release.yml | grep -q "env.USE_CACHE == 'true'"; then
  pass "ccache step checks USE_CACHE flag"
else
  fail "ccache step missing USE_CACHE check"
fi

if grep -A5 "name: Restore node-source cache" .github/workflows/release.yml | grep -q "env.USE_CACHE == 'true'"; then
  pass "node-source cache step checks USE_CACHE flag"
else
  fail "node-source cache step missing USE_CACHE check"
fi

if grep -A5 "name: Restore Release binary cache" .github/workflows/release.yml | grep -q "env.USE_CACHE == 'true'"; then
  pass "Release binary cache step checks USE_CACHE flag"
else
  fail "Release binary cache step missing USE_CACHE check"
fi

if grep -A5 "name: Restore Stripped binary cache" .github/workflows/release.yml | grep -q "env.USE_CACHE == 'true'"; then
  pass "Stripped binary cache step checks USE_CACHE flag"
else
  fail "Stripped binary cache step missing USE_CACHE check"
fi

if grep -A5 "name: Restore Compressed binary cache" .github/workflows/release.yml | grep -q "env.USE_CACHE == 'true'"; then
  pass "Compressed binary cache step checks USE_CACHE flag"
else
  fail "Compressed binary cache step missing USE_CACHE check"
fi

if grep -A5 "name: Restore Final binary cache" .github/workflows/release.yml | grep -q "env.USE_CACHE == 'true'"; then
  pass "Final binary cache step checks USE_CACHE flag"
else
  fail "Final binary cache step missing USE_CACHE check"
fi

if grep -A5 "name: Restore checkpoints cache" .github/workflows/release.yml | grep -q "env.USE_CACHE == 'true'"; then
  pass "Checkpoints cache step checks USE_CACHE flag"
else
  fail "Checkpoints cache step missing USE_CACHE check"
fi

echo ""
echo "Test 3: Verify version validation logic"
echo "==========================================="

if grep -q 'EXPECTED_VERSION="\${{ env.NODE_VERSION }}"' .github/workflows/release.yml; then
  pass "Version validation extracts expected version"
else
  fail "Version validation missing expected version extraction"
fi

if grep -q "ACTUAL_VERSION=" .github/workflows/release.yml && grep -q "grep -oE" .github/workflows/release.yml; then
  pass "Version validation extracts actual version from binary"
else
  fail "Version validation missing actual version extraction"
fi

if grep -q 'ACTUAL_VERSION.*EXPECTED_VERSION' .github/workflows/release.yml; then
  pass "Version validation compares versions"
else
  fail "Version validation missing version comparison"
fi

if grep -q "Version mismatch: expected" .github/workflows/release.yml; then
  pass "Version validation has mismatch error message"
else
  fail "Version validation missing error message"
fi

echo ""
echo "Test 4: Verify documentation updates"
echo "==========================================="

if [ -f ".claude/caching-implementation.md" ]; then
  pass "caching-implementation.md exists"

  if grep -q "NODE_VERSION" .claude/caching-implementation.md; then
    pass "Documentation mentions NODE_VERSION"
  else
    warn "Documentation doesn't mention NODE_VERSION"
  fi

  if grep -q "USE_CACHE" .claude/caching-implementation.md; then
    pass "Documentation mentions USE_CACHE"
  else
    warn "Documentation doesn't mention USE_CACHE"
  fi

  if grep -q "version validation" .claude/caching-implementation.md; then
    pass "Documentation mentions version validation"
  else
    warn "Documentation doesn't mention version validation"
  fi
else
  fail "caching-implementation.md missing"
fi

if [ -f ".claude/phase-0-completion-summary.md" ]; then
  pass "phase-0-completion-summary.md exists"
else
  warn "phase-0-completion-summary.md missing (optional)"
fi

if [ -f ".claude/deployment-checklist.md" ]; then
  pass "deployment-checklist.md exists"
else
  warn "deployment-checklist.md missing (optional)"
fi

echo ""
echo "Test 5: Verify YAML syntax"
echo "==========================================="

# Check if yamllint is available
if command -v yamllint &> /dev/null; then
  if yamllint -d relaxed .github/workflows/release.yml 2>&1 | grep -q "error"; then
    fail "YAML syntax errors detected"
    yamllint -d relaxed .github/workflows/release.yml
  else
    pass "YAML syntax is valid"
  fi
else
  warn "yamllint not installed, skipping YAML validation"
  echo "  Install with: brew install yamllint (macOS) or apt-get install yamllint (Linux)"
fi

echo ""
echo "Test 6: Simulate version validation logic"
echo "==========================================="

# Simulate the version extraction logic (macOS/Linux compatible)
TEST_OUTPUT="v22.11.0"
EXPECTED="22"
ACTUAL=$(echo "$TEST_OUTPUT" | grep -oE 'v[0-9]+' | sed 's/v//' || echo "")

if [ "$ACTUAL" = "$EXPECTED" ]; then
  pass "Version extraction logic works (extracted $ACTUAL from $TEST_OUTPUT)"
else
  fail "Version extraction failed (expected $EXPECTED, got $ACTUAL)"
fi

# Test with different formats
TEST_OUTPUT2="v23.0.0"
EXPECTED2="23"
ACTUAL2=$(echo "$TEST_OUTPUT2" | grep -oE 'v[0-9]+' | sed 's/v//' || echo "")

if [ "$ACTUAL2" = "$EXPECTED2" ]; then
  pass "Version extraction works with Node.js 23 (extracted $ACTUAL2)"
else
  fail "Version extraction failed for Node.js 23"
fi

# Test empty output
TEST_OUTPUT3=""
ACTUAL3=$(echo "$TEST_OUTPUT3" | grep -oE 'v[0-9]+' | sed 's/v//' || echo "")

if [ -z "$ACTUAL3" ]; then
  pass "Version extraction handles empty output gracefully"
else
  fail "Version extraction should return empty for empty input"
fi

echo ""
echo "=========================================="
echo "Test Results Summary"
echo "=========================================="
echo ""
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed! Ready for deployment.${NC}"
  exit 0
else
  echo -e "${RED}✗ Some tests failed. Please review and fix issues before deploying.${NC}"
  exit 1
fi

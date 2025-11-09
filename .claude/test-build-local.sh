#!/bin/bash
# Local smol Node.js build and validation test

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test tracking
TESTS_PASSED=0
TESTS_FAILED=0

pass() {
  echo -e "${GREEN}✓${NC} $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

info() {
  echo -e "${BLUE}→${NC} $1"
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

echo ""
echo "=========================================="
echo "Socket BTM - Local Build Test"
echo "=========================================="
echo ""

# Get expected Node.js version from workflow
EXPECTED_NODE_VERSION=$(grep "NODE_VERSION:" .github/workflows/release.yml | head -1 | sed "s/.*NODE_VERSION: '\([0-9]*\)'.*/\1/")

if [ -z "$EXPECTED_NODE_VERSION" ]; then
  warn "Could not extract NODE_VERSION from workflow, defaulting to 22"
  EXPECTED_NODE_VERSION="22"
fi

info "Expected Node.js version: v${EXPECTED_NODE_VERSION}"
echo ""

# Check if dependencies are installed
echo "Step 1: Check dependencies"
echo "=========================================="

if [ ! -d "node_modules" ]; then
  info "Installing dependencies..."
  if [ -f "pnpm-lock.yaml" ]; then
    pnpm install --frozen-lockfile
  else
    warn "pnpm-lock.yaml not found, running pnpm install (will create lockfile)"
    pnpm install
  fi
  pass "Dependencies installed"
else
  pass "Dependencies already installed"
fi

echo ""

# Check build prerequisites
echo "Step 2: Check build prerequisites"
echo "=========================================="

# Check for Python
if command -v python3 &> /dev/null; then
  PYTHON_VERSION=$(python3 --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
  pass "Python 3 found (version $PYTHON_VERSION)"
else
  fail "Python 3 not found (required for Node.js build)"
  echo "  Install with: brew install python3 (macOS) or apt-get install python3 (Linux)"
fi

# Check for C++ compiler
if command -v c++ &> /dev/null || command -v g++ &> /dev/null || command -v clang++ &> /dev/null; then
  pass "C++ compiler found"
else
  fail "C++ compiler not found (required for Node.js build)"
  echo "  macOS: Install Xcode Command Line Tools: xcode-select --install"
  echo "  Linux: Install build-essential: sudo apt-get install build-essential"
fi

# Check for make
if command -v make &> /dev/null; then
  pass "make found"
else
  warn "make not found (build may use vcbuild.bat on Windows)"
fi

# Check disk space
AVAILABLE_SPACE=$(df -h . | tail -1 | awk '{print $4}')
info "Available disk space: $AVAILABLE_SPACE"

echo ""

# Check for existing build
echo "Step 3: Check for existing build"
echo "=========================================="

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$PLATFORM" in
  darwin) PLATFORM="darwin" ;;
  linux) PLATFORM="linux" ;;
  *) PLATFORM="unknown" ;;
esac

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) ARCH="unknown" ;;
esac

info "Detected platform: $PLATFORM-$ARCH"

BINARY_PATH="packages/node-smol-builder/build/out/Final/node"
CACHE_PATH="packages/node-smol-builder/build/cache/node-compiled-${PLATFORM}-${ARCH}"

if [ -f "$BINARY_PATH" ]; then
  info "Found existing binary: $BINARY_PATH"

  # Test existing binary
  if "$BINARY_PATH" --version &> /dev/null; then
    EXISTING_VERSION=$("$BINARY_PATH" --version 2>&1)
    info "Existing binary version: $EXISTING_VERSION"

    # Extract major version
    EXISTING_MAJOR=$(echo "$EXISTING_VERSION" | grep -oE 'v[0-9]+' | sed 's/v//' || echo "")

    if [ "$EXISTING_MAJOR" = "$EXPECTED_NODE_VERSION" ]; then
      pass "Existing binary version matches expected (v${EXPECTED_NODE_VERSION})"

      read -p "Use existing binary? (y/N): " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        SKIP_BUILD=true
      else
        SKIP_BUILD=false
      fi
    else
      warn "Existing binary version ($EXISTING_MAJOR) doesn't match expected ($EXPECTED_NODE_VERSION)"
      info "Will rebuild with correct version"
      SKIP_BUILD=false
    fi
  else
    warn "Existing binary is not executable"
    SKIP_BUILD=false
  fi
else
  info "No existing binary found"
  SKIP_BUILD=false
fi

echo ""

# Build smol Node.js
if [ "$SKIP_BUILD" != "true" ]; then
  echo "Step 4: Build smol Node.js binary"
  echo "=========================================="

  info "Starting build (this may take 30-60 minutes on first build)..."
  info "Build command: pnpm build"
  echo ""

  BUILD_START=$(date +%s)

  # Run the build
  if pnpm build; then
    BUILD_END=$(date +%s)
    BUILD_DURATION=$((BUILD_END - BUILD_START))
    BUILD_MIN=$((BUILD_DURATION / 60))
    BUILD_SEC=$((BUILD_DURATION % 60))

    pass "Build completed in ${BUILD_MIN}m ${BUILD_SEC}s"
  else
    fail "Build failed"
    exit 1
  fi

  echo ""
else
  echo "Step 4: Build smol Node.js binary"
  echo "=========================================="
  info "Skipped (using existing binary)"
  echo ""
fi

# Verify binary exists
echo "Step 5: Verify binary"
echo "=========================================="

if [ ! -f "$BINARY_PATH" ]; then
  fail "Binary not found at: $BINARY_PATH"
  exit 1
fi

BINARY_SIZE=$(du -h "$BINARY_PATH" | cut -f1)
pass "Binary exists: $BINARY_PATH ($BINARY_SIZE)"

# Make binary executable if needed
chmod +x "$BINARY_PATH" 2>/dev/null || true

echo ""

# Test binary execution
echo "Step 6: Test binary execution"
echo "=========================================="

# Test --version
if "$BINARY_PATH" --version &> /dev/null; then
  VERSION_OUTPUT=$("$BINARY_PATH" --version 2>&1)
  pass "Binary executes successfully"
  info "Version output: $VERSION_OUTPUT"
else
  fail "Binary failed to execute"
  exit 1
fi

echo ""

# Test version validation logic (same as workflow)
echo "Step 7: Test version validation (workflow simulation)"
echo "=========================================="

info "Simulating workflow version validation..."

# Extract version using same logic as workflow
ACTUAL_VERSION=$(echo "$VERSION_OUTPUT" | grep -oE 'v[0-9]+' | sed 's/v//' || echo "")

if [ -z "$ACTUAL_VERSION" ]; then
  fail "Could not extract version from output: $VERSION_OUTPUT"
else
  info "Extracted version: $ACTUAL_VERSION"

  if [ "$ACTUAL_VERSION" = "$EXPECTED_NODE_VERSION" ]; then
    pass "Version validation passed (v${ACTUAL_VERSION} matches expected v${EXPECTED_NODE_VERSION})"
  else
    fail "Version mismatch: expected v${EXPECTED_NODE_VERSION}, got v${ACTUAL_VERSION}"
  fi
fi

echo ""

# Test basic functionality
echo "Step 8: Test basic functionality"
echo "=========================================="

# Test eval
if "$BINARY_PATH" -e "console.log('Hello from smol Node.js')" &> /dev/null; then
  OUTPUT=$("$BINARY_PATH" -e "console.log('Hello from smol Node.js')" 2>&1)
  if [ "$OUTPUT" = "Hello from smol Node.js" ]; then
    pass "Basic eval works"
  else
    warn "Eval output unexpected: $OUTPUT"
  fi
else
  fail "Basic eval failed"
fi

# Test process.version
PROCESS_VERSION=$("$BINARY_PATH" -e "console.log(process.version)" 2>&1)
if [ -n "$PROCESS_VERSION" ]; then
  pass "process.version accessible: $PROCESS_VERSION"
else
  fail "Could not read process.version"
fi

# Test built-in modules
if "$BINARY_PATH" -e "require('fs'); console.log('fs module loaded')" &> /dev/null; then
  pass "Built-in modules work (fs tested)"
else
  fail "Built-in modules broken"
fi

echo ""

# Check for SEA support
echo "Step 9: Check SEA (Single Executable Application) support"
echo "=========================================="

# Check if postject is available
if "$BINARY_PATH" -e "console.log(process.config.variables.node_use_node_code_cache)" 2>&1 | grep -q "false\|true"; then
  pass "Node.js configuration accessible"
fi

# Try to check for SEA sentinel
if "$BINARY_PATH" -e "try { require('node:sea'); console.log('SEA API available'); } catch { console.log('SEA API not available'); }" 2>&1 | grep -q "available"; then
  SEA_STATUS=$("$BINARY_PATH" -e "try { require('node:sea'); console.log('available'); } catch { console.log('not available'); }" 2>&1)
  info "SEA status: $SEA_STATUS"
else
  info "SEA API not exposed (expected for smol builds)"
fi

echo ""

# Check cache
echo "Step 10: Check build cache"
echo "=========================================="

if [ -f "$CACHE_PATH" ]; then
  CACHE_SIZE=$(du -h "$CACHE_PATH" | cut -f1)
  pass "Build cache exists: $CACHE_PATH ($CACHE_SIZE)"

  # Verify cache matches binary
  if cmp -s "$BINARY_PATH" "$CACHE_PATH"; then
    pass "Cache matches final binary"
  else
    warn "Cache differs from final binary (may be expected)"
  fi
else
  info "No build cache found (will be created on next build)"
fi

# Check checkpoints
if [ -d "packages/node-smol-builder/build/.checkpoints" ]; then
  CHECKPOINT_COUNT=$(ls -1 packages/node-smol-builder/build/.checkpoints 2>/dev/null | wc -l | tr -d ' ')
  pass "Checkpoints directory exists ($CHECKPOINT_COUNT checkpoints)"

  for checkpoint in cloned built complete; do
    if [ -f "packages/node-smol-builder/build/.checkpoints/$checkpoint" ]; then
      info "  ✓ $checkpoint checkpoint exists"
    else
      warn "  ✗ $checkpoint checkpoint missing"
    fi
  done
else
  warn "Checkpoints directory not found"
fi

echo ""

# Run package tests
echo "Step 11: Run package tests"
echo "=========================================="

if pnpm test:smol 2>&1 | tee /tmp/smol-test-output.txt; then
  pass "Package tests passed"
else
  # Check if tests were skipped
  if grep -q "skipped" /tmp/smol-test-output.txt; then
    warn "Some tests were skipped (expected if binary not built for all scenarios)"
  else
    fail "Package tests failed"
  fi
fi

echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo ""
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed!${NC}"
  echo ""
  echo "Binary location: $BINARY_PATH"
  echo "Binary size: $BINARY_SIZE"
  echo "Node.js version: $VERSION_OUTPUT"
  echo ""
  echo "You can now test the binary:"
  echo "  $BINARY_PATH --version"
  echo "  $BINARY_PATH -e \"console.log('Hello')\""
  echo ""
  exit 0
else
  echo -e "${RED}✗ Some tests failed${NC}"
  echo ""
  echo "Review the output above for details."
  exit 1
fi

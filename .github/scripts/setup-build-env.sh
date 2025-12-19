#!/bin/bash
# Setup build environment for binject
# This script must be sourced or used inline to export environment variables

set -e

# Install platform-specific dependencies
node .github/scripts/setup-linux-deps.mjs

# Windows uses gcc/g++ (MinGW) by default for ABI consistency with LIEF
# No need to set CC/CXX environment variables

# Build binject with configured environment
echo "Building binject..."
pnpm --filter binject build

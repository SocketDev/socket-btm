#!/bin/bash
# Setup build environment for tests.
# Installs platform-specific dependencies but does NOT build binaries.
# Tests that require binaries (binject, binpress, etc.) will skip gracefully if not built.
# Use binsuite.yml workflow to build binaries.

set -e

# Install platform-specific dependencies.
node .github/scripts/setup-linux-deps.mjs

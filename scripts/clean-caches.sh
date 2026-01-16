#!/usr/bin/env bash
#
# Clean all caches for socket-btm.
#
# This script removes:
# 1. GitHub Actions checkpoint caches (via gh CLI).
# 2. Local build artifacts (packages/*/build/).
#
# Note: Depot Docker layer caches are invalidated automatically when
# CACHE_VERSION or LIEF_CACHE_VERSION build args change (echoed in RUN commands).
#
# Usage: ./scripts/clean-caches.sh [--confirm]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CONFIRM="${1:-}"

echo "🧹 Cleaning socket-btm caches..."
echo ""

# Clean GitHub Actions caches.
echo "📦 Listing GitHub Actions caches..."
CACHE_COUNT=$(gh cache list --limit 1000 | wc -l | tr -d ' ')

if [ "$CACHE_COUNT" -eq 0 ]; then
  echo "   ✓ No GitHub Actions caches found"
else
  echo "   Found $CACHE_COUNT caches"

  if [ "$CONFIRM" = "--confirm" ]; then
    echo "   Deleting all GitHub Actions caches..."
    gh cache list --limit 1000 | awk '{print $1}' | while read -r cache_id; do
      if [ -n "$cache_id" ]; then
        gh cache delete "$cache_id" 2>/dev/null || echo "   ⚠️  Failed to delete cache $cache_id"
      fi
    done
    echo "   ✅ Deleted all GitHub Actions caches"
  else
    echo "   ⏭️  Skipping deletion (run with --confirm to delete)"
  fi
fi

echo ""

# Clean local build artifacts.
echo "🗑️  Cleaning local build artifacts..."

PACKAGES=(
  "binpress"
  "binflate"
  "binject"
  "bin-infra"
  "models"
  "node-smol-builder"
  "onnxruntime-builder"
  "yoga-layout-builder"
)

for pkg in "${PACKAGES[@]}"; do
  BUILD_DIR="packages/${pkg}/build"
  if [ -d "$BUILD_DIR" ]; then
    if [ "$CONFIRM" = "--confirm" ]; then
      echo "   Removing ${BUILD_DIR}..."
      rm -rf "$BUILD_DIR"
    else
      echo "   Would remove ${BUILD_DIR}"
    fi
  fi
done

if [ "$CONFIRM" = "--confirm" ]; then
  echo "   ✅ Cleaned local build artifacts"
else
  echo "   ⏭️  Skipping deletion (run with --confirm to delete)"
fi

echo ""

# Summary.
if [ "$CONFIRM" = "--confirm" ]; then
  echo "✅ Cache cleanup complete"
  echo ""
  echo "Next steps:"
  echo "1. Trigger a fresh build: gh workflow run binsuite.yml -f tools=binject"
  echo "2. Monitor build logs to verify fresh LIEF download"
else
  echo "🔍 Dry run complete (run with --confirm to actually delete caches)"
  echo ""
  echo "This would delete:"
  echo "- $CACHE_COUNT GitHub Actions caches"
  echo "- Local build directories for all packages"
fi

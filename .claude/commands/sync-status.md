# sync-status - Check Node.js version status

Check current Node.js version vs latest available upstream.

Quick read-only command to see if an update is available.

## Usage

```bash
/sync-status
```

## What It Shows

- Current version (from `.node-version`)
- Current upstream tag (from submodule)
- Latest available tag (from upstream)
- Update available status

## Implementation

```bash
# Current version
CURRENT_VERSION=$(cat .node-version)
echo "Current .node-version: $CURRENT_VERSION"

# Current upstream tag
cd packages/node-smol-builder/upstream/node
CURRENT_TAG=$(git describe --tags 2>/dev/null || echo "unknown")
echo "Current upstream tag: $CURRENT_TAG"

# Fetch latest tags
git fetch origin --tags --quiet 2>/dev/null

# Latest tag (exclude rc/beta)
LATEST_TAG=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v 'rc' | grep -v 'beta' | head -1)
LATEST_VERSION="${LATEST_TAG#v}"  # Remove 'v' prefix

echo "Latest available: $LATEST_TAG ($LATEST_VERSION)"
cd ../../..

# Compare
if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
  echo "✓ Up to date"
else
  echo "⚠ Update available: $CURRENT_VERSION → $LATEST_VERSION"
  echo ""
  echo "To update: /sync"
fi
```

## Example Output

**Up to date:**
```
Current .node-version: 25.5.0
Current upstream tag: v25.5.0
Latest available: v25.5.0 (25.5.0)
✓ Up to date
```

**Update available:**
```
Current .node-version: 25.5.0
Current upstream tag: v25.5.0
Latest available: v25.6.0 (25.6.0)
⚠ Update available: 25.5.0 → 25.6.0

To update: /sync
```

## Success Criteria

- ✅ Current version retrieved from `.node-version`
- ✅ Current upstream tag retrieved from submodule
- ✅ Latest available tag fetched from upstream
- ✅ Comparison result displayed (up to date or update available)
- ✅ Status check completes without errors
- ✅ No modifications made (read-only operation)

**Note:** This command does not emit a completion promise as it's a read-only status check.

## Edge Cases

**Submodule not initialized:**
```bash
# Initialize submodule first
git submodule update --init --recursive packages/node-smol-builder/upstream/node

# Then retry
/sync-status
```

**Git fetch fails (network issues):**
```bash
# Command shows current state even if fetch fails
# Latest tag will be based on locally cached tags

# Manual fetch:
cd packages/node-smol-builder/upstream/node
git fetch origin --tags
cd ../../..
```

**.node-version file missing:**
```bash
# Create file with current version
echo "25.5.0" > .node-version

# Or use sync to initialize
/sync
```

**Submodule is dirty or detached:**
```bash
# Command still works but may show inconsistent state
# To fix:
cd packages/node-smol-builder/upstream/node
git status
git checkout <tag>  # Checkout proper tag
cd ../../..
```

## Related Commands

- `/sync` - Update to latest Node.js version

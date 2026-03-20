---
name: updating-curl
description: Updates curl and mbedtls submodules to latest stable versions. Triggers when user mentions "update curl", "TLS security patch", or HTTP client fixes.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-curl

<task>
Your task is to update the curl and mbedtls submodules to their latest stable versions, validate build and tests pass, bump cache versions, and commit changes with detailed changelogs.
</task>

<context>
**What is curl?**
curl is the HTTP client library used by socket-btm for network operations. mbedTLS provides TLS/SSL support for curl.

**socket-btm Architecture:**

- curl tracked via submodule: `packages/curl-builder/upstream/curl`
- mbedtls tracked via submodule: `packages/curl-builder/upstream/mbedtls`
- Version pinned in `.gitmodules` (commit hash + semantic version comment)
- mbedtls is always updated together with curl (same skill)

**Why Update:**

- Security patches for TLS/HTTP vulnerabilities
- Bug fixes in HTTP handling
- New features and performance improvements
- Access new curl/mbedtls APIs

**Critical Files:**

- `.gitmodules` - curl and mbedtls submodule configuration with version pinning
- `packages/curl-builder/upstream/curl` - Git submodule tracking curl/curl
- `packages/curl-builder/upstream/mbedtls` - Git submodule tracking Mbed-TLS/mbedtls
- `.github/cache-versions.json` - Cache version keys for CI invalidation

**Cache Version Bump:**
When curl is updated, bump these cache versions in `.github/cache-versions.json`:
- `curl` - curl library artifacts
- `stubs` - stubs-builder uses curl for HTTP support
- `binpress` - binpress embeds stubs
- `node-smol` - node-smol is compressed with binpress
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting (no uncommitted changes)
- Target versions MUST be stable releases (no -rc/-alpha/-beta)
- Cache versions MUST be bumped after update

**CI Mode (detected via `CI=true` or `GITHUB_ACTIONS` env var):**
- Skip build validation (CI runs builds in separate workflow jobs)
- Skip test validation (CI runs tests in separate workflow jobs)
- Focus on: version updates, cache bumps, commits only
- Do NOT push changes (workflow handles push)

**Interactive Mode (default):**
- Build MUST succeed without errors
- Tests MUST pass (100% success rate)

**Do NOT:**

- Update to unstable/pre-release versions
- Forget to update both curl AND mbedtls
- Forget to bump cache versions
- Push changes when in CI mode

**Do ONLY:**

- Update to stable release tags
- Update both curl and mbedtls together
- Bump cache versions after successful update
- Use conventional commit format with detailed changelog
</constraints>

<instructions>

## Process

### Phase 1: Validate Environment

<action>
Check working directory is clean:
</action>

```bash
git status
```

<validation>
**Expected State:**
- ✓ Working directory clean (no uncommitted changes)

**If working directory NOT clean:**
- Commit or stash changes before proceeding

Do NOT proceed if environment checks fail.
</validation>

---

### Phase 2: Determine Target Versions

<action>
Auto-detect latest stable versions:
</action>

```bash
# Fetch curl tags
cd packages/curl-builder/upstream/curl
git fetch origin --tags

# Get current version
CURL_CURRENT=$(git describe --tags 2>/dev/null || echo "unknown")
echo "Current curl: $CURL_CURRENT"

# Get latest stable (format: curl-X_Y_Z)
CURL_LATEST=$(git tag -l 'curl-*' --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1)
echo "Latest curl: $CURL_LATEST"
cd ../../../..

# Fetch mbedtls tags
cd packages/curl-builder/upstream/mbedtls
git fetch origin --tags

# Get current version
MBEDTLS_CURRENT=$(git describe --tags 2>/dev/null || echo "unknown")
echo "Current mbedtls: $MBEDTLS_CURRENT"

# Get latest stable (format: vX.Y.Z or mbedtls-X.Y.Z)
MBEDTLS_LATEST=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1)
echo "Latest mbedtls: $MBEDTLS_LATEST"
cd ../../../..
```

**Check if updates needed:**
- If curl and mbedtls already at latest, report "Already up to date" and exit
- If updates available, proceed with update

---

### Phase 3: Update Submodules

<action>
Checkout latest versions:
</action>

```bash
# Update curl
cd packages/curl-builder/upstream/curl
git checkout "$CURL_LATEST"
CURL_COMMIT=$(git rev-parse HEAD)
cd ../../../..

# Update mbedtls
cd packages/curl-builder/upstream/mbedtls
git checkout "$MBEDTLS_LATEST"
MBEDTLS_COMMIT=$(git rev-parse HEAD)
cd ../../../..

echo "Updated curl to $CURL_LATEST ($CURL_COMMIT)"
echo "Updated mbedtls to $MBEDTLS_LATEST ($MBEDTLS_COMMIT)"
```

---

### Phase 4: Update .gitmodules

<action>
Update version comments in .gitmodules:
</action>

Use the Edit tool to update the version comments in `.gitmodules`:
- Update curl comment: `# curl-X.Y.Z` (convert from curl-X_Y_Z format)
- Update mbedtls comment: `# mbedtls-X.Y.Z`

---

### Phase 5: Validate Build and Tests

<action>
Run full validation (skip in CI mode):
</action>

```bash
# Detect CI mode
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  echo "CI mode: Skipping build validation (CI will run builds separately)"
else
  cd packages/curl-builder
  pnpm run clean
  pnpm run build || exit 1
  pnpm test || exit 1
  cd ../..

  echo "✅ Build and tests passed"
fi
```

<validation>
**Expected Output (Interactive):**
```
✅ Build and tests passed
```

**Expected Output (CI):**
```
CI mode: Skipping build validation (CI will run builds separately)
```

**If validation fails:**
- Review build errors
- May indicate API changes requiring code updates
- Do NOT proceed to commit if validation fails
</validation>

---

### Phase 6: Bump Cache Versions

<action>
Bump cache versions in .github/cache-versions.json if submodules were updated:
</action>

**Skip this phase if:** curl and mbedtls are already at latest versions (Phase 2 reported "Already up to date"). In this case, no changes were made and no cache bump is needed.

**If submodules were updated:** Use the Read tool to get current cache versions, then use Edit tool to bump:
- `curl`: Increment version (e.g., v17 → v18)
- `stubs`: Increment version (stubs-builder depends on curl)
- `binpress`: Increment version (binpress embeds stubs)
- `node-smol`: Increment version (node-smol compressed with binpress)

**Note:** When submodules are updated, ALWAYS bump all four cache versions - even if binaries appear identical, dependencies changed so caches must be invalidated.

---

### Phase 7: Commit Changes

<action>
Stage and commit all changes:
</action>

```bash
# Convert curl version to human-readable format (curl-8_18_0 → 8.18.0)
CURL_VERSION=$(echo "$CURL_LATEST" | sed 's/curl-//' | tr '_' '.')
MBEDTLS_VERSION=$(echo "$MBEDTLS_LATEST" | sed 's/^v//')

git add .gitmodules packages/curl-builder/upstream .github/cache-versions.json

git commit -m "chore(curl-builder): update curl to $CURL_VERSION and mbedtls to $MBEDTLS_VERSION

Update curl and mbedtls submodules to latest stable releases.

Updated:
- curl: $CURL_CURRENT → $CURL_LATEST
- mbedtls: $MBEDTLS_CURRENT → $MBEDTLS_LATEST
- Cache versions bumped: curl, stubs, binpress, node-smol

Validation:
- Build: SUCCESS
- Tests: PASS"
```

---

### Phase 8: Report Summary

<action>
Generate final summary:
</action>

```
## curl Update Complete

**curl:** $CURL_CURRENT → $CURL_LATEST
**mbedtls:** $MBEDTLS_CURRENT → $MBEDTLS_LATEST

**Cache versions bumped:**
- curl, stubs, binpress, node-smol

**Validation:**
- ✅ Build: SUCCESS
- ✅ Tests: PASS

**Next Steps:**
**Interactive mode:**
1. Review changes: `git log -1 --stat`
2. Push to remote: `git push origin main`

**CI mode:**
1. Workflow will push branch and create PR
2. CI will run full build/test validation
```

</instructions>

## Success Criteria

- ✅ curl submodule updated to latest stable
- ✅ mbedtls submodule updated to latest stable
- ✅ .gitmodules updated with new version comments
- ✅ Build succeeded without errors
- ✅ Tests passed (100%)
- ✅ Cache versions bumped: curl, stubs, binpress, node-smol
- ✅ Commit created with detailed changelog
- ✅ Ready for push to remote

## Commands

This skill uses direct git and pnpm commands for simplicity.

## Context

This skill is useful for:

- Applying curl/mbedtls security patches
- Fixing HTTP/TLS bugs
- Accessing new curl features
- Regular maintenance (quarterly or as-needed)

**Safety:** Working directory must be clean. Validation ensures build/tests pass before committing. Rollback available with `git reset --hard HEAD~1`.

**Post-Update Considerations:**
- **external-tools.json**: Check if `packages/curl-builder/external-tools.json` and `packages/stubs-builder/external-tools.json` need updates
- **Pinned dependencies**: All dependencies (dev and direct) are pinned to exact versions. After updating, run `pnpm run update` to check for compatible dependency updates.

---
name: updating-checksums
description: Updates SHA-256 checksums from GitHub releases to release-assets.json. Triggers when user mentions "update checksums", "sync checksums", or after releasing new tool versions.
user-invocable: true
allowed-tools: Bash, Read, Edit
---

# updating-checksums

<task>
Your task is to sync SHA-256 checksums from GitHub releases to the embedded `release-assets.json` file, ensuring offline builds have up-to-date integrity verification.
</task>

<context>
**What is this?**
socket-btm downloads prebuilt tools (lief, curl, stubs, binpress, binflate, binject) from GitHub releases. Each release includes a `checksums.txt` file with SHA-256 hashes for integrity verification.

**Architecture:**

- `packages/build-infra/release-assets.json` - Embedded checksums (works offline)
- `packages/build-infra/lib/release-checksums.mjs` - Verification logic (checks embedded first, then network)
- `packages/build-infra/scripts/sync-checksums.mjs` - Sync script

**Checksum Lookup Priority:**
1. In-memory cache (fastest)
2. Embedded checksums from `release-assets.json` (offline support)
3. Network fetch from GitHub releases (fallback)

**Why Sync?**
- After publishing new releases, embedded checksums become stale
- Offline builds need up-to-date checksums
- Version-controlled checksums enable audit trail

**Tools with Checksums:**
- `lief` - LIEF binary manipulation library
- `curl` - curl with mbedTLS
- `stubs` - Self-extracting stub binaries
- `libpq` - PostgreSQL client library
- `binpress` - Binary compression tool
- `binflate` - Binary decompression tool
- `binject` - Binary injection tool
</context>

<constraints>
**CRITICAL Requirements:**
- GitHub CLI (`gh`) must be authenticated
- Network access required to fetch from GitHub

**Do NOT:**
- Modify checksums manually (always fetch from releases)
- Skip verification after sync
- Commit without reviewing changes

**Do ONLY:**
- Fetch checksums from official GitHub releases
- Update release-assets.json with new checksums
- Verify the JSON is valid after update
</constraints>

<instructions>

## Process

### Phase 1: Check Current State

<action>
Review current embedded checksums:
</action>

```bash
# Show current release tags in release-assets.json
grep -E '"githubRelease"' packages/build-infra/release-assets.json
```

---

### Phase 2: Sync Checksums

<action>
Run the sync script to fetch latest checksums:
</action>

```bash
# Sync all tools
pnpm --filter build-infra sync-checksums

# Or sync specific tool
# pnpm --filter build-infra sync-checksums --tool=lief
```

<validation>
**Expected Output:**
```
Syncing checksums for 7 tool(s)...

[lief] Fetching checksums for lief...
  Using embedded checksums for lief (lief-20260315-9b1c032)
...

Summary: X updated, Y unchanged
```

**If sync fails:**
- Check GitHub CLI authentication: `gh auth status`
- Check network connectivity
- Verify release exists: `gh release list --repo SocketDev/socket-btm`
</validation>

---

### Phase 3: Verify Changes

<action>
Review the updated checksums:
</action>

```bash
# Show what changed
git diff packages/build-infra/release-assets.json

# Validate JSON syntax
node -e "JSON.parse(require('fs').readFileSync('packages/build-infra/release-assets.json'))"
```

---

### Phase 4: Commit Changes (if any)

<action>
If checksums were updated, commit the changes:
</action>

```bash
# Only if there are changes
git add packages/build-infra/release-assets.json
git commit -m "chore(build-infra): sync release asset checksums

Update embedded SHA-256 checksums from GitHub releases.
Enables offline builds with up-to-date integrity verification."
```

</instructions>

## Success Criteria

- ✅ All tools synced from GitHub releases
- ✅ release-assets.json updated with latest checksums
- ✅ JSON syntax validated
- ✅ Changes committed (if any updates)

## Commands

```bash
# Sync all tools
pnpm --filter build-infra sync-checksums

# Sync specific tool
pnpm --filter build-infra sync-checksums --tool=lief

# Dry run (show what would change)
pnpm --filter build-infra sync-checksums --dry-run

# Force update even if unchanged
pnpm --filter build-infra sync-checksums --force
```

## Context

This skill is useful for:

- After publishing new releases to GitHub
- Before creating release branches
- When offline builds fail checksum verification
- Regular maintenance to keep checksums current

**Safety:** Checksums are fetched from official GitHub releases only. The script validates checksums.txt format before updating.

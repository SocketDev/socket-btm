Sync SHA-256 checksums from GitHub releases to release-assets.json using the syncing-checksums skill.

## What it does

1. Fetches checksums.txt from latest GitHub releases
2. Updates packages/build-infra/release-assets.json
3. Validates JSON syntax
4. Commits changes (if any)

## Tools synced

- lief - LIEF binary manipulation library
- curl - curl with mbedTLS
- stubs - Self-extracting stub binaries
- libpq - PostgreSQL client library
- binpress - Binary compression tool
- binflate - Binary decompression tool
- binject - Binary injection tool

## Usage

```bash
/sync-checksums
```

## Manual commands

```bash
# Sync all tools
pnpm --filter build-infra sync-checksums

# Sync specific tool
pnpm --filter build-infra sync-checksums --tool=lief

# Dry run
pnpm --filter build-infra sync-checksums --dry-run
```

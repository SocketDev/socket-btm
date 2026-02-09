# LIEF Patches

Patches applied to the vendored LIEF library during build.

## Patches

### `lief/001-remove-note-size-limit.patch`

Removes the 1MB note description size limit introduced in LIEF 0.14.0.

**Why needed**: Node.js SEA blobs are typically 7-10MB. LIEF's 1MB limit
(added as a security measure) truncates these blobs silently, causing
binject to produce non-functional executables.

**Root cause**: LIEF 0.14.0 (January 2024) added `MAX_NOTE_DESCRIPTION = 1_MB`
in `Note::create()` as part of ELF note refactoring. postject works because
it bundles LIEF 0.12.1 (April 2022) which predates this limit.

## Applying Patches

Patches are applied automatically during LIEF build. To apply manually:

```bash
cd upstream/lief
git apply ../../patches/lief/001-remove-note-size-limit.patch
```

## Updating Patches

When updating LIEF to a new version:

1. Check if the patch still applies cleanly
2. If not, regenerate against the new source
3. Update the `@lief-commit` header in the patch file

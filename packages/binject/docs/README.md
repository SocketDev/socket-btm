# binject Documentation

Documentation for the binary injection tool.

## Overview

binject injects SEA (Single Executable Application) and VFS (Virtual Filesystem) resources into Node.js binaries. It supports Mach-O (macOS), ELF (Linux), and PE (Windows) formats.

## Documentation Index

### Architecture

- [smol-injection-flow.md](smol-injection-flow.md) - SMOL stub injection and repack workflow

### Quick Reference

| Format | Platform | Injection Method |
|--------|----------|------------------|
| Mach-O | macOS | LIEF (NODE_SEA segment) |
| ELF | Linux | LIEF (NODE_SEA segment) |
| PE | Windows | LIEF (.sea/.vfs resources) |

### Section Names

| Section | Segment | Purpose |
|---------|---------|---------|
| `__NODE_SEA_BLOB` | `NODE_SEA` | SEA application blob |
| `__SMOL_VFS_BLOB` | `NODE_SEA` | Virtual filesystem blob |
| `__SMOL_VFS_CONFIG` | `NODE_SEA` | SMOL configuration (1192 bytes) |
| `__PRESSED_DATA` | `SMOL` | LZFSE-compressed Node.js binary |

### Key Commands

```bash
# Inject SEA blob
binject inject -e node -o output --sea app.blob

# Inject SEA + VFS
binject inject -e node -o output --sea app.blob --vfs vfs.blob

# Inject from sea-config.json (pass JSON config to --sea)
binject inject -e node -o output --sea sea-config.json

# Skip repack (modify cached binary only)
binject inject -e node-smol -o output --sea app.blob --skip-repack
```

### Configuration Formats

**SMFG (SMOL Config)**: 1192 bytes binary format
- Magic: `SMFG`
- Version: 2
- Contains: update URL, glob pattern, notification settings

**SVFG (VFS Config)**: 366 bytes binary format
- Magic: `SVFG`
- Version: 1
- Contains: VFS mode, compression, prefix path

## Troubleshooting

### "Binary format not recognized"

```bash
# Verify input binary format
file node
# Expected: Mach-O, ELF, or PE executable
```

**Cause:** Input is not a valid executable or is corrupted.

### "SEA blob too large"

**Cause:** SEA blob exceeds segment size limits.

**Solution:** Ensure blob is under 500 MB (practical limit).

### "Cannot inject into uncompressed stub"

**Cause:** Attempting to inject SEA/VFS into a SMOL stub without using `--skip-repack`.

**Solution:**
```bash
# Use --skip-repack for SMOL binaries
binject inject -e node-smol -o output --sea app.blob --skip-repack
```

### macOS: "Signature invalid after injection"

**Cause:** Injection modifies binary, invalidating existing signature.

**Solution:**
```bash
# Re-sign with ad-hoc signature
codesign --sign - --force output
```

## Related Packages

- [node-smol-builder](../../node-smol-builder/docs/) - Builds node-smol binary
- [bin-infra](../../bin-infra/docs/) - Shared binary utilities
- [binpress](../../binpress/docs/) - Binary compression

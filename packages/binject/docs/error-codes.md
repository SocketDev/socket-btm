# Error Codes Reference

This document lists all error codes and their meanings for binject and related tools.

## Return Value Conventions

All C functions follow this convention:
- `0` = Success
- `-1` = Error (check errno or error message)
- Positive values = Context-specific (e.g., bytes written)

## binject Error Codes

### General Errors

| Code | Constant | Description | Resolution |
|------|----------|-------------|------------|
| -1 | `BINJECT_ERROR_GENERIC` | Generic error | Check stderr for details |
| -1 | `BINJECT_ERROR_INVALID_INPUT` | Invalid input parameter | Verify all required parameters |
| -1 | `BINJECT_ERROR_FILE_NOT_FOUND` | Input file doesn't exist | Check file path |
| -1 | `BINJECT_ERROR_PERMISSION_DENIED` | Cannot read/write file | Check file permissions |

### Format Detection Errors

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| "Unknown binary format" | Magic bytes not recognized | Verify input is Mach-O/ELF/PE |
| "Cannot detect format" | File too small | Input file may be truncated |
| "Unsupported format for injection" | Format not supported | Use supported binary format |

### Injection Errors

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| "Failed to parse binary with LIEF" | LIEF parse error | Binary may be corrupted |
| "NODE_SEA segment already exists" | Re-injection without removal | Use `--overwrite` or remove existing |
| "Failed to flip NODE_SEA_FUSE" | Fuse pattern not found | Binary may not be Node.js |
| "Failed to create segment" | LIEF memory error | Reduce injection size |
| "Failed to write binary" | Disk full or permission | Check disk space/permissions |

### SMOL Stub Errors

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| "Not a SMOL compressed stub" | Missing magic marker | Input is not SMOL-compressed |
| "Cannot extract SMOL stub" | Decompression failed | Stub may be corrupted |
| "Cannot stat extracted binary" | Cache access issue | Check `~/.socket/_dlx/` permissions |
| "Compression failed" | LZFSE error | Check available memory |

### Code Signing Errors (macOS)

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| "codesign failed" | Ad-hoc signing failed | Check codesign is available |
| "Signature verification failed" | Invalid signature | Re-sign with valid certificate |
| "Binary already signed, skipping" | Info message | No action needed |

## binpress Error Codes

### Compression Errors

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| "Input file not found" | Binary doesn't exist | Check file path |
| "Unsupported target" | Invalid --target value | Use valid platform-arch-libc |
| "No matching stub" | Stub not found for target | Build stubs first |
| "LZFSE compression failed" | Compression error | Check input file validity |

### Stub Selection Errors

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| "Cannot auto-detect format" | Unknown binary type | Specify --target explicitly |
| "Stub not available for target" | Missing embedded stub | Rebuild binpress with stubs |

## binflate Error Codes

### Extraction Errors

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| "Magic marker not found" | Not a SMOL binary | Input is not SMOL-compressed |
| "Invalid metadata" | Corrupted header | Binary may be truncated |
| "Decompression failed" | LZFSE error | Data may be corrupted |
| "Output size exceeds limit" | >500MB uncompressed | Safety limit exceeded |

### Metadata Validation Errors

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| "Invalid compressed size" | Size mismatch | Header corruption |
| "Invalid uncompressed size" | Size mismatch | Header corruption |
| "Invalid platform code" | Unknown platform byte | Unsupported platform |

## stubs-builder Error Codes

### Stub Execution Errors

| Exit Code | Meaning | Resolution |
|-----------|---------|------------|
| 1 | Decompression failed | Cache may be corrupted |
| 2 | Cache write failed | Check disk space |
| 3 | Execution failed | Binary may be invalid |

### Cache Errors

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| "Cannot create cache directory" | Permission denied | Check `~/.socket/` permissions |
| "Cannot write to cache" | Disk full | Free disk space |
| "Cache validation failed" | Corrupted cache | Delete `~/.socket/_dlx/` |

## Compression Library Errors

### LZFSE Errors

| Code | Meaning |
|------|---------|
| `COMPRESSION_STATUS_OK` | Success |
| `COMPRESSION_STATUS_ERROR` | Generic error |
| `COMPRESSION_STATUS_DST_TOO_SMALL` | Output buffer too small |

### Error Handling Example

```c
int result = binject_batch(config);
if (result != 0) {
    fprintf(stderr, "Injection failed: %s\n", binject_get_last_error());
    return 1;
}
```

## Debugging Tips

### Enable Debug Output

```bash
# Set debug environment variable
export BINJECT_DEBUG=1

# Or use verbose flag
binject --verbose ...
```

### Common Issues

1. **"Cannot stat extracted binary"**
   - The `.injected` file was moved/deleted during repack
   - Solution: Check cache directory state

2. **"LIEF parse error"**
   - Binary has unsupported features
   - Solution: Check LIEF version compatibility

3. **"Signature verification failed"**
   - macOS Gatekeeper issue
   - Solution: Use proper code signing certificate

4. **"Cache key mismatch"**
   - Binary was modified after compression
   - Solution: Re-compress the binary

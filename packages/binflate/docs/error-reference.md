# Error Reference

Complete reference for binflate error messages, causes, and solutions.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (see stderr for details) |

## Error Messages

### Input Validation Errors

#### "Error: No input file specified"

**Cause:** No input file path provided.

**Solution:**
```bash
binflate <input-file> -o <output-file>
```

#### "Error: Cannot read input file: <path>"

**Cause:** File doesn't exist or no read permission.

**Solution:**
- Check file exists: `ls -la <input-file>`
- Check permissions: `chmod +r <input-file>`

#### "Error: --output requires a path argument"

**Cause:** The `-o` or `--output` flag was used without a path.

**Solution:**
```bash
binflate input -o /path/to/output
```

#### "Error: Unexpected argument: <arg>"

**Cause:** Unknown command-line argument provided.

**Solution:** Check `binflate --help` for valid arguments.

### Format Detection Errors

#### "Error: Not a compressed binary (magic marker not found)"

**Cause:** Input is not a binpress-compressed binary.

**Solution:**
- Verify input was compressed with `binpress`
- Check file wasn't truncated during copy

```bash
# Verify file format
file <input-file>
# Should show executable or data, not empty
```

#### "Error: Input file is not a compressed binary"

**Cause:** Same as above - file doesn't contain SMOL marker.

**Solution:** Ensure the binary was compressed with `binpress`.

### Metadata Errors

#### "Error: Failed to read SMOL metadata"

**Cause:** Could not read metadata section after magic marker.

**Solution:** Re-compress the source binary with `binpress`.

#### "Error: Invalid SMOL metadata"

**Cause:** Metadata section is corrupted (sizes invalid or exceed limits).

**Solution:**
- Verify source binary isn't corrupted
- Re-compress with `binpress`

### I/O Errors

#### "Error: Failed to open input file: <reason>"

**Cause:** Cannot open the input file for reading.

**Possible causes:**
- File doesn't exist
- Permission denied
- File is locked by another process

**Solution:**
```bash
# Check file exists and is readable
ls -la <input-file>
chmod +r <input-file>
```

#### "Error: Failed to seek to compressed data: <reason>"

**Cause:** Cannot seek to the data offset in the file.

**Solution:** The file may be corrupted or on a non-seekable device.

#### "Error: Failed to read compressed data: <reason>"

**Cause:** Read operation failed while reading compressed data.

**Solution:**
- Check disk for I/O errors
- Verify file isn't being modified during read

#### "Error: Unexpected end of file (expected <n> bytes, got <m>)"

**Cause:** File is truncated - less data than metadata indicates.

**Solution:**
- Re-download or re-copy the compressed binary
- Re-compress from original source

### Memory Errors

#### "Error: Failed to allocate memory"

**Cause:** Not enough memory to allocate decompression buffers.

**Note:** binflate needs memory for both compressed and uncompressed data.

**Solution:**
- Free system memory
- Check available RAM: `free -h` (Linux) or Activity Monitor (macOS)
- Try on machine with more RAM

### Decompression Errors

#### "Error: Decompression failed (code: <n> = <description>)"

**Cause:** LZFSE decompression failed.

**Error codes:**
| Code | Description |
|------|-------------|
| -1 | INVALID_INPUT - Null pointer or zero-size buffer |
| -2 | ALLOC_FAILED - Memory allocation failed |
| -3 | COMPRESS_FAILED - Compression operation failed |
| -4 | DECOMPRESS_FAILED - Data corrupted or not LZFSE |
| -5 | UNSUPPORTED_ALGORITHM - Only LZFSE supported |
| -6 | SIZE_LIMIT_EXCEEDED - Decompressed size > 512 MB |

**Diagnostic output:**
```
Cause: Data offset points to SMFG config instead of compressed data.
```
- The decompressor tried to decompress config data instead of actual compressed data.

```
Cause: Data at offset does not appear to be LZFSE-compressed.
First 4 bytes: 0x<hex> (expected LZFSE stream header)
```
- The data doesn't have LZFSE magic bytes.

**Solution:**
```bash
# Re-compress from original
binpress <original-binary> -o <output>
binflate <output>
```

### Output Errors

#### "Error: Failed to write output file"

**Cause:** Cannot write the decompressed data to output file.

**Possible causes:**
- No write permission in directory
- Disk full
- Parent directory doesn't exist

**Solution:**
```bash
# Check directory exists
mkdir -p $(dirname <output-path>)

# Check disk space
df -h .

# Check write permission
touch <output-path>
```

## CLI Behavior Notes

### Default Output Filename

When `-o` is not specified, binflate generates output name by:
1. Removing `-compressed` suffix
2. Removing `.bin` suffix
3. Removing `.out` suffix

```bash
binflate node-compressed    # Output: node
binflate app.bin            # Output: app
binflate myapp.out          # Output: myapp
```

### Interactive Overwrite Prompt

When output file exists and stdout is a TTY:
```
Warning: Output file '<name>' already exists. Overwrite? (y/N):
```

To skip prompt (for scripts):
```bash
yes | binflate input -o output
# or redirect stdin
binflate input -o output < /dev/null  # Will not overwrite
```

### Progress Output

binflate shows progress during extraction:
```
Extracting compressed binary...
  Input: <input-path>
  Output: <output-path>
  Compressed size: X.XX MB
  Uncompressed size: X.XX MB
  Reading compressed data...
  Decompressing...
  Writing to output...

✓ Extraction successful!
  Output: <output-path> (X.XX MB)
```

## Error Recovery Checklist

1. **Verify input file:**
   ```bash
   file <input>
   ls -la <input>
   ```

2. **Check disk space:**
   ```bash
   df -h .
   ```

3. **Check memory:**
   ```bash
   # Linux
   free -h

   # macOS
   vm_stat
   ```

4. **Try verbose mode:**
   ```bash
   DEBUG="*" binflate <input> -o <output>
   ```

5. **Re-compress source:**
   ```bash
   binpress <original> -o <compressed>
   binflate <compressed> -o <output>
   ```

## Related Documentation

- [README](README.md) - Overview and basic usage

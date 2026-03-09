# How to Debug Injection Issues

Troubleshooting guide for binject injection problems.

## Enable Debug Output

### Verbose Mode

```bash
binject --verbose --sea app.blob -o myapp node
```

### Environment Variable

```bash
export BINJECT_DEBUG=1
binject --sea app.blob -o myapp node
```

### Debug Output Example

```
Detected SMOL compressed stub
Extracting SMOL stub using LIEF...
  Stub: /path/to/node-smol
  Output: /Users/user/.socket/_dlx/97f5a39a4b819a25/node
  Found __PRESSED_DATA section: 21881014 bytes
  Parsing SMOL metadata...
  Compressed size: 21879754 bytes
  Uncompressed size: 63708968 bytes
  Decompressing... (algorithm: LZFSE)
  ✓ Extracted (60 MB)
Looking up extracted binary in cache...
Found extracted binary: /Users/user/.socket/_dlx/97f5a39a4b819a25/node
Injecting resource into /Users/user/.socket/_dlx/97f5a39a4b819a25/node...
  Format: Mach-O
  SEA resource: app.blob (148 bytes)
Using LIEF for batch injection...
Ready to parse binary
Flipping NODE_SEA_FUSE...
✓ Flipped NODE_SEA_FUSE from :0 to :1
Creating SEA section __NODE_SEA_BLOB with 148 bytes...
Adding NODE_SEA segment to binary...
Successfully injected SEA section
```

## Common Issues

### Issue: "Unknown binary format"

**Symptoms:**
```
Error: Unknown binary format
```

**Causes:**
- Input file is not a valid executable
- File is truncated or corrupted
- Unsupported binary format

**Diagnosis:**
```bash
# Check file type
file myapp

# Check magic bytes
xxd myapp | head -1
```

**Expected output:**
```
# Mach-O
myapp: Mach-O 64-bit executable arm64

# ELF
myapp: ELF 64-bit LSB executable, x86-64

# PE
myapp: PE32+ executable (console) x86-64
```

**Resolution:**
- Use a valid Node.js binary
- Re-download if corrupted

---

### Issue: "Failed to flip NODE_SEA_FUSE"

**Symptoms:**
```
Error: Failed to flip NODE_SEA_FUSE
```

**Causes:**
- Binary is not Node.js
- Fuse pattern was modified
- Binary was compiled without SEA support

**Diagnosis:**
```bash
# Search for fuse pattern
strings myapp | grep "NODE_SEA_FUSE"
```

**Expected output:**
```
NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0
```

**Resolution:**
- Use official Node.js binary (v20+)
- Ensure Node.js was compiled with SEA support

---

### Issue: "NODE_SEA segment already exists"

**Symptoms:**
```
NODE_SEA segment already exists
Removing existing segment for re-injection...
```

This is informational, not an error. binject handles re-injection.

---

### Issue: "Cannot stat extracted binary"

**Symptoms:**
```
Error: Cannot stat extracted binary
```

**Causes:**
- Cache file was deleted during operation
- Permission issues
- Disk full

**Diagnosis:**
```bash
# Check cache directory
ls -la ~/.socket/_dlx/

# Check specific cache entry
ls -la ~/.socket/_dlx/*/
```

**Resolution:**
```bash
# Clear cache and retry
rm -rf ~/.socket/_dlx/
binject --sea app.blob -o myapp node-smol
```

---

### Issue: "codesign failed" (macOS)

**Symptoms:**
```
Error: codesign failed
```

**Causes:**
- codesign not available
- Certificate issues
- Binary is locked

**Diagnosis:**
```bash
# Check codesign availability
which codesign

# Check current signature
codesign -dv myapp
```

**Resolution:**
```bash
# Sign manually with ad-hoc signature
codesign --sign - --force --deep myapp

# Verify signature
codesign -v myapp
```

---

### Issue: "Compression failed"

**Symptoms:**
```
Error: Compression failed
```

**Causes:**
- Out of memory
- Input too large
- Corrupted data

**Diagnosis:**
```bash
# Check input size
ls -la ~/.socket/_dlx/*/node

# Check available memory
free -h  # Linux
vm_stat  # macOS
```

**Resolution:**
- Free memory
- Check input file integrity

---

### Issue: VFS Files Not Accessible at Runtime

**Symptoms:**
- `fs.readFileSync()` returns error
- VFS files seem missing

**Causes:**
- Wrong VFS mode
- Incorrect prefix path
- VFS not mounted

**Diagnosis:**
```javascript
// Check if VFS is available
const sea = require('node:sea');
console.log('Is SEA:', sea.isSea());
console.log('Has VFS:', typeof sea.getAsset !== 'undefined');

// List VFS contents
const vfs = require('internal/socketsecurity/vfs');
console.log('VFS mounted:', vfs.isMounted());
```

**Resolution:**
- Match VFS mode to access pattern
- Check prefix configuration
- Ensure VFS blob was injected

---

## Inspecting Binaries

### View Segments (Mach-O)

```bash
otool -l myapp | grep -A 10 "segname SMOL\|segname NODE_SEA"
```

### View Sections (ELF)

```bash
readelf -S myapp | grep -E "smol|sea|vfs"
```

### View Resources (PE)

```bash
objdump -p myapp | grep -A 5 "RCDATA"
```

### Using LIEF (Cross-platform)

```python
import lief

binary = lief.parse("myapp")

# List all segments/sections
for section in binary.sections:
    print(f"{section.name}: {section.size} bytes")

# Check for SEA segment
if binary.format == lief.Binary.FORMATS.MACHO:
    for segment in binary.segments:
        print(f"Segment: {segment.name}")
        for section in segment.sections:
            print(f"  Section: {section.name}")
```

## Cache Management

### View Cache Contents

```bash
ls -la ~/.socket/_dlx/

# Output:
# 97f5a39a4b819a25/
# a1b2c3d4e5f67890/
```

### Check Cache Entry

```bash
ls -la ~/.socket/_dlx/97f5a39a4b819a25/

# Output:
# node              # Decompressed binary
# node.injected     # After injection (may exist)
# .dlx-metadata.json
```

### Clear Specific Entry

```bash
rm -rf ~/.socket/_dlx/97f5a39a4b819a25/
```

### Clear All Cache

```bash
rm -rf ~/.socket/_dlx/
```

## Validation Steps

### 1. Verify Input Binary

```bash
file input-binary
./input-binary --version
```

### 2. Verify SEA Blob

```bash
file app.blob
ls -la app.blob
```

### 3. Verify Output

```bash
file myapp
./myapp --version
codesign -v myapp  # macOS
```

### 4. Test SEA

```bash
./myapp -e "console.log(require('node:sea').isSea())"
# Expected: true
```

### 5. Test VFS

```bash
./myapp -e "console.log(require('fs').existsSync('/vfs/asset.txt'))"
# Expected: true (if VFS was injected with assets)
```

## Getting Help

If issues persist:

1. Run with `--verbose` and `BINJECT_DEBUG=1`
2. Capture full output
3. Check binary format and sizes
4. Open issue with reproduction steps

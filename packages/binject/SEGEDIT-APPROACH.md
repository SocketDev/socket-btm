# Using segedit for Mach-O Section Resizing

## Overview

Instead of using LIEF (a heavy C++ library), we use macOS's built-in `segedit` tool for resizing Mach-O sections.

## How segedit Works

```bash
segedit input_file -replace seg_name sect_name data_file -output output_file
```

- Takes section content from `data_file`
- Creates `output_file` with the section resized to match `data_file` size
- Automatically rounds section size to 4-byte boundary
- Works with any section size (including 1-byte placeholders)

## Implementation Strategy

### Current: C-based approach (complex)
```c
// Would require:
// 1. Parse Mach-O headers manually
// 2. Find section location and size
// 3. Calculate new offsets for all following data
// 4. Rewrite entire binary with correct alignments
// 5. Update all load commands
```

### Proposed: Shell-based approach (simple)
```bash
#!/bin/bash
# inject_macho.sh <binary> <segment> <section> <data_file>

BINARY="$1"
SEGMENT="$2"
SECTION="$3"
DATA="$4"

# Use segedit to replace the section
segedit "$BINARY" \
  -replace "$SEGMENT" "$SECTION" "$DATA" \
  -output "$BINARY.new"

# Replace original with resized binary
mv "$BINARY.new" "$BINARY"

# Code-sign the modified binary (required on macOS)
codesign --sign - --force "$BINARY"
```

## Integration with binject

Update `binject inject` to:

### For macOS (darwin):
1. Detect platform is macOS
2. Write resource data to temp file
3. Call `segedit` to resize and replace section:
   - SEA: `segedit node -replace NODE_SEA __NODE_SEA_BLOB sea.blob -output node.new`
   - VFS: `segedit node -replace NODE_SEA __NODE_VFS_BLOB vfs.blob -output node.new`
4. Replace original binary with resized one
5. Code-sign the result

### For Linux/Windows:
- Keep existing implementation (ELF/PE don't need pre-created sections)

## Benefits

1. **Zero Dependencies**: `segedit` is built into macOS (part of Xcode Command Line Tools)
2. **Reliable**: Apple's own tool, guaranteed to work with Mach-O format
3. **Simple**: 3-line shell script vs hundreds of lines of C code
4. **Maintainable**: No need to track Mach-O format changes

## Testing

```bash
# Create test binary with 1-byte sections
clang -Wl,-sectcreate,NODE_SEA,__NODE_SEA_BLOB,/dev/zero \
      -Wl,-sectcreate,NODE_SEA,__NODE_VFS_BLOB,/dev/zero \
      test.c -o test

# Verify sections are 1 byte
otool -l test | grep -A 12 NODE_SEA

# Inject larger data
echo "This is test SEA data (>1 byte)" > sea.dat
segedit test -replace NODE_SEA __NODE_SEA_BLOB sea.dat -output test.new

# Verify section was resized
otool -l test.new | grep -A 12 NODE_SEA
# Should show size = 0x20 (32 bytes, rounded up from 31)
```

## Implementation Plan

1. Update `src/macho_inject.c` to detect if section needs resizing
2. If data > section size:
   - Write data to `/tmp/binject_XXXXX.dat`
   - Call `segedit` via `system()` or `popen()`
   - Clean up temp file
3. Otherwise use existing direct-write approach (for compatibility)

## Alternative: Keep it in JavaScript

Since the build system already uses JavaScript, we could implement this in the test helper:

```javascript
// test/helpers/binject.mjs
async function runBinject(binaryPath, resourceName, resourcePath, options) {
  if (process.platform === 'darwin') {
    // Use segedit for macOS
    const segment = 'NODE_SEA';
    const section = resourceName === 'NODE_SEA_BLOB' ? '__NODE_SEA_BLOB' : '__NODE_VFS_BLOB';

    await spawn('segedit', [
      binaryPath,
      '-replace', segment, section, resourcePath,
      '-output', `${binaryPath}.new`
    ]);

    await spawn('mv', [`${binaryPath}.new`, binaryPath]);
    await spawn('codesign', ['--sign', '-', '--force', binaryPath]);
  } else {
    // Use binject for other platforms
    await spawn(binjectPath, args);
  }
}
```

This would:
- Work immediately (no C code changes needed)
- Be easier to debug and maintain
- Still allow binject to work for non-macOS platforms

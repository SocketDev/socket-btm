# tar_parser.js -- Pure JavaScript TAR archive parser

## What This File Does

Parses a TAR (Tape ARchive) file -- the format used to bundle all your
application files into a single blob that gets embedded in the binary.
It reads the TAR byte-by-byte (in 512-byte blocks), extracts file names,
sizes, permissions, and content, and builds a Map of path -> entry objects.

## How It Fits in the VFS System

loader.js -> THIS FILE (tar_parser.js)
-> internalBinding('smol_vfs') (for SIMD-accelerated checksum/zero-block)

loader.js calls parseTar(buffer) which returns a SafeMap:

```
Map {
  'package.json' -> { type: 'file', content: <Buffer>, mode: 0o644 },
  'lib/'         -> { type: 'directory', mode: 0o755 },
  'lib/index.js' -> { type: 'file', content: <Buffer>, mode: 0o644 },
  'bin/cli'      -> { type: 'symlink', linkTarget: '../lib/cli.js' },
}
```

## Key Concepts

- TAR format: Created in the 1970s for tape drives. A TAR file is a
  sequence of entries, each consisting of:
  [512-byte header] [file data padded to 512 bytes] [next header] ...
  The archive ends with two consecutive 512-byte blocks of all zeros.

- TAR header fields: Each 512-byte header contains fixed-position fields:
  Bytes 0-99: filename (100 chars max, or use PAX for longer)
  Bytes 100-107: file permissions in octal (e.g., "0000755\0")
  Bytes 124-135: file size in octal (e.g., "00000001234\0")
  Bytes 148-155: header checksum (sum of all bytes, for integrity)
  Byte 156: type flag ('0'=file, '5'=directory, '2'=symlink)
  Bytes 257-262: magic "ustar\0" (identifies USTAR format)
  Bytes 345-499: prefix (for filenames > 100 chars)

- Checksum: Sum of all 512 header bytes (treating the checksum field
  itself as spaces). Used to detect corruption. Delegated to C++ SIMD
  code for speed.

- PAX extended headers: Modern TAR extension for long filenames (>100 chars),
  large files (>8GB), and UTF-8 names. Format: "LENGTH KEY=VALUE\n"

- GNU long names: Older extension for long filenames. Uses special header
  types ('L' for long name, 'K' for long link name).

- Lazy content: Large files (>256 bytes) are NOT copied when parsing.
  Instead, the entry stores an offset into the original TAR buffer.
  The actual Buffer slice is created on first access via getContent().
  This means parsing a 100MB archive is nearly instant -- no copying.

- Zero-copy: The lazy content strategy means the parsed VFS entries
  point directly into the original TAR buffer in memory. The buffer
  slices share the same underlying memory until the entry is accessed.

## VFS Entry Structure

Each entry in the VFS map is an object with:

- type: 'file' | 'directory' | 'symlink'
- mode: File permissions (octal, e.g., 0o755 for executables, 0o644 for regular files)
- content: Buffer (for files), undefined (for directories or lazy entries)
- linkTarget: string (for symlinks only)
- \_sourceBuffer, \_bufferOffset, \_bufferLength: (lazy files only) zero-copy
  references into the source tar buffer, materialized on first getContent() call

# Binary Compressed Checkpoint

Platform-specific compression for minimal distribution size.

## Flow

```
Stripped (25MB) → Compress → Compressed (6-8MB) + Decompressor (50-100KB)
                  (platform)  (~75-80% reduction)
```

## Compression by Platform

| Platform | Algorithm | Ratio | Tool |
|----------|-----------|-------|------|
| **macOS** | LZFSE | 78% | Apple Compression |
| **Linux** | ZLIB | 76% | zlib |
| **Windows** | LZMA | 80% | liblzma |

## Runtime Decompression

```
First Run:  Decompress to cache (~150ms) → Execute
Cached Run: Verify checksum (~10ms) → Execute
```

## Cache Locations

```
macOS:   ~/Library/Caches/node-smol/
Linux:   ~/.cache/node-smol/
Windows: %LOCALAPPDATA%\node-smol\Cache\
```

## Compression Tools

C++ compressors in `postjected/`:
- `macho_compress.c` / `macho_decompress.c`
- `elf_compress.c` / `elf_decompress.c`
- `pe_compress.c` / `pe_decompress.c`

## Output

```
build/{mode}/out/Compressed/
├── node                                # 6-8MB
└── socketsecurity_*_decompress         # 50-100KB
```

## Dependencies

Requires: `binary-stripped` checkpoint.

## Next

`finalized` - Select and copy to Final/ directory.

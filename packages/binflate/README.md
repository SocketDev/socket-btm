# binflate

Binary decompression tools for Mach-O, ELF, and PE executables.

## Platform Support

- **macOS**: LZFSE/LZMA decompression for Mach-O binaries
- **Linux**: LZMA decompression for ELF binaries
- **Windows**: LZMS decompression for PE binaries

## Sources

- `macho_decompress.c` - macOS Mach-O decompression
- `elf_decompress.c` - Linux ELF decompression
- `pe_decompress.c` - Windows PE decompression

Requires `dlx_cache_common.h` from `bin-infra` package.

## Building

```bash
make
```

This builds the platform-specific decompression binary to `out/socketsecurity_decompress[.exe]`.

## Usage

Built binaries are referenced by `node-smol-builder` during its build process.

## Testing

```bash
make test
```

## License

MIT

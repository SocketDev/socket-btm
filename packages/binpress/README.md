# binpress

Binary compression tools for Mach-O, ELF, and PE executables.

## Platform Support

- **macOS**: LZFSE/LZMA compression for Mach-O binaries
- **Linux**: LZMA compression for ELF binaries
- **Windows**: LZMS compression for PE binaries

## Sources

- `macho_compress.c` - macOS Mach-O compression
- `elf_compress.c` - Linux ELF compression
- `pe_compress.c` - Windows PE compression

Requires `dlx_cache_common.h` from `bin-infra` package.

## Building

```bash
make
```

This builds the platform-specific compression binary to `out/socketsecurity_compress[.exe]`.

## Usage

Built binaries are referenced by `node-smol-builder` during its build process.

## Testing

```bash
make test
```

## License

MIT

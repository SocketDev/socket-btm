# binject

Binary resource injection tool for Mach-O, ELF, and PE executables.

## Features

- Inject resources into NODE_SEA or NODE_VFS sections
- Automatic compression (LZFSE/LZMA/LZMS based on platform)
- List, extract, and verify embedded resources
- Platform-specific implementations:
  - **macOS**: Mach-O using [`segedit`](https://ss64.com/mac/segedit.html) for section manipulation
  - **Linux**: ELF using direct binary manipulation
  - **Windows**: PE using direct binary manipulation

## Building

```bash
make
```

Outputs `out/binject` (or `out/binject.exe` on Windows).

## Installation

After building, you can install binject to make it available system-wide:

### macOS

```bash
# Option 1: Install to /usr/local/bin (Requires sudo)
sudo make install

# Option 2: Create symlink
ln -s $(pwd)/out/binject /usr/local/bin/binject

# Option 3: Add to PATH (add to ~/.zshrc or ~/.bashrc)
export PATH="$PATH:$(pwd)/out"
```

<details>
<summary>Linux Installation</summary>

```bash
# Option 1: Install to /usr/local/bin (Requires sudo)
sudo make install

# Option 2: Create symlink
ln -s $(pwd)/out/binject /usr/local/bin/binject

# Option 3: Add to PATH (add to ~/.bashrc)
export PATH="$PATH:$(pwd)/out"
```

</details>

<details>
<summary>Windows Installation</summary>

```powershell
# Copy to a directory in your PATH
copy out\binject.exe C:\Windows\System32\

# Or add to PATH
$env:PATH += ";$(Get-Location)\out"
```

</details>

### Verify Installation

```bash
binject --help
# Should display usage information
```

### Uninstall

```bash
sudo make uninstall
```

## Usage

### Inject Resources

```bash
# Inject SEA blob (Single Executable Application)
binject inject -o ./node -r app.blob --sea

# Inject VFS blob (Virtual File System)
binject inject -o ./node -r vfs.blob --vfs

# Inject without compression
binject inject -o ./node -r app.blob --sea --no-compress

# Overwrite existing section
binject inject -o ./node -r app.blob --sea --overwrite
```

### List Resources

```bash
binject list ./node
```

### Extract Resources

```bash
# Extract SEA blob
binject extract -e ./node --sea -o app.blob

# Extract VFS blob
binject extract -e ./node --vfs -o vfs.blob
```

## Section Names

- `NODE_SEA_BLOB` - SEA (Single Executable Application) blob
- `NODE_VFS_BLOB` - VFS (Virtual File System) blob

## Platform Support

| Platform | Binary Format | Compression | Status |
|----------|--------------|-------------|--------|
| macOS    | Mach-O       | LZFSE/LZMA  | ✅ Fully implemented (uses [`segedit`](https://ss64.com/mac/segedit.html)) |
| Linux    | ELF          | LZMA        | ✅ Fully implemented |
| Windows  | PE           | LZMS        | ✅ Fully implemented |

## Notes

- On macOS, binaries are automatically code-signed with ad-hoc signature after injection
- Compression can be disabled with `--no-compress` flag
- VFS blobs are NOT compressed (binpress compresses entire binary instead)
- SEA blobs automatically flip sentinel byte for Node.js compatibility

## License

MIT

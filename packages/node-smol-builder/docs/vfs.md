# VFS Implementation

Virtual Filesystem support for embedding TAR/TAR.GZ archives in Node.js executables.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Node.js Executable                         │
├─────────────────────────────────────────────────────────────┤
│ NODE_SEA_BLOB        │ Bootstrap code (Node.js controls)    │
│ CUSTOM_VFS_BLOB      │ TAR/TAR.GZ archive (user controls)   │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────────────┐
                    │  C++ VFS Layer  │
                    │  (node_vfs.cc)  │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ JS VFS Layer    │
                    │ (loader.js)     │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │  TAR Parser     │
                    │  (hybrid mode)  │
                    └────────┬────────┘
                             ↓
              ┌──────────────┴──────────────┐
              ↓                             ↓
      Native tar (fast)          Pure JS (portable)
```

## File Organization

### JavaScript Files
**Location:** `additions/source-patched/js/vfs/`

| File | Purpose |
|------|---------|
| `tar_parser.js` | Pure JS TAR parser (PAX/GNU, checksums) |
| `tar_parser_native.js` | System tar command wrapper |
| `tar_parser_hybrid.js` | Auto-selects native or JS parser |
| `tar_gzip.js` | Gzip compression via Node.js zlib |
| `loader.js` | VFS initialization and caching |
| `fs_shim.js` | Patches fs module for VFS access |
| `vfs_bootstrap.js` | Bootstrap helper |

### C++ Files
**Location:** `additions/source-patched/cpp/vfs/` (copied via patch requirements)

- `src/node_vfs.cc` - Reads CUSTOM_VFS_BLOB via postject
- `src/node_vfs.h` - C++ API declarations
- `node.gyp` - Build configuration

## Build Flow

```
┌──────────────────────┐
│  source-cloned       │  Clone Node.js source
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│  source-patched      │  ← VFS patch applied here
│                      │  ← VFS JS files copied here
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│  binary-released     │  Compile with VFS support
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│  binary-stripped     │  Remove debug symbols
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│  binary-compressed   │  Platform compression
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│  finalized           │  Ready for distribution
└──────────────────────┘
```

## Features

✅ PAX extended headers (unlimited filenames)
✅ GNU long name support
✅ Checksum verification
✅ Gzip compression/decompression
✅ Hybrid native/JS parsing
✅ Zero-copy access to embedded data
✅ Zero external dependencies

## TAR Format Support

| Feature | USTAR | PAX | GNU |
|---------|-------|-----|-----|
| Filenames | ≤255 chars | Unlimited | Unlimited |
| File size | ≤8GB | Unlimited | ≤8GB |
| Timestamps | Basic | Extended | Basic |
| **Support** | ✅ | ✅ | ✅ |

## Runtime Flow

```
Application requires('internal/vfs/loader')
           ↓
   hasVFS() checks for CUSTOM_VFS_BLOB
           ↓
   initVFS() parses TAR archive
           ↓
   fs_shim intercepts fs calls
           ↓
   isVFSPath() checks if path is in VFS
           ↓
   readFileFromVFS() returns embedded data
```

## Usage

VFS is automatically initialized when `CUSTOM_VFS_BLOB` resource is present. The build system handles:

1. **Source patching** - C++ VFS support added
2. **File copying** - JS VFS files copied to `lib/internal/socketsecurity_vfs/`
3. **Compilation** - Node.js built with VFS enabled
4. **Resource injection** - Use postject to inject CUSTOM_VFS_BLOB

```bash
# Inject VFS archive (use NODE_VFS segment to avoid conflicts with NODE_SEA_BLOB)
npx postject node CUSTOM_VFS_BLOB app.tar.gz \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_VFS
```

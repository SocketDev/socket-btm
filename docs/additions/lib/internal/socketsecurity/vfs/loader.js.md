# loader.js -- VFS initialization, path resolution, and data access

## What This File Does

This is the "brain" of the VFS. It does three critical things:

1. INIT: Reads the raw TAR blob from C++ (via internalBinding), decompresses
   it if gzipped, and parses it into a Map<string, entry> using tar_parser.js.
2. PATH RESOLUTION: Converts filesystem paths like '/snapshot/node_modules/foo'
   into VFS map keys like 'node_modules/foo', handling trailing slashes,
   implicit directories, and execPath-relative paths.
3. DATA ACCESS: Provides readFileFromVFS(), statFromVFS(), readdirFromVFS()
   etc. that look up entries in the parsed VFS map.

## How It Fits in the VFS System

fs.js / fs_shim.js -> THIS FILE (loader.js)
-> tar_parser.js (parseTar function)
-> tar_gzip.js (gzip decompression, lazy-loaded)
-> internalBinding('smol_vfs') (C++ binding to read the embedded blob)

The VFS map (vfsCache) is a SafeMap where:
key = relative path (e.g., 'node_modules/lodash/index.js')
value = entry object { type, content, mode, linkTarget, ... }

## Key Concepts

- VFS prefix: The virtual mount point (default '/snapshot'). All VFS
  paths start with this prefix. Configurable via NODE_VFS_PREFIX env var
  or embedded config.
- execPath-relative paths: Node.js SEA resolves require() paths relative
  to process.execPath. So '/usr/bin/myapp/node_modules/foo' is also a
  valid VFS path if /usr/bin/myapp is the executable.
- Implicit directories: TAR archives don't always include directory entries.
  If 'lib/foo.js' exists but 'lib/' doesn't, loader.js infers that 'lib'
  is a directory by scanning all path prefixes.
- Path caching: Hot paths like toVFSPath() use a bounded cache (max 1000
  entries) to avoid repeated string manipulation. The cache never goes
  stale because VFS is immutable.
- VFS modes: Three extraction strategies:
  'in-memory' -- extract to temp dir (default, works on read-only filesystems)
  'on-disk' -- extract to persistent cache (~/.socket/\_dlx/)
  'compat' -- no extraction, VFS disabled

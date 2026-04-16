# bootstrap.js -- VFS initialization during Node.js startup

## What This File Does

This is the very first VFS code that runs. Node.js calls setupVFS()
during its bootstrap sequence (before your app code starts). It checks
if a VFS blob is embedded in the binary. If yes, it initializes the
VFS and installs "shims" (wrappers) around Node's built-in `fs` module
so that `fs.readFileSync('/snapshot/...')` transparently reads from the
embedded archive instead of the real filesystem.

## How It Fits in the VFS System

This is the ENTRY POINT -- called by Node.js internal bootstrap code:
Node.js startup -> bootstrap.js (this file)
-> checks internalBinding('smol_vfs').hasVFSBlob()
-> if VFS exists:
-> loader.js (parses the TAR archive)
-> fs_shim.js (patches the `fs` module)

## Key Concepts

- Bootstrap: The code that runs when Node.js first starts, before any
  user code. Modules loaded here must be careful about dependencies
  because many Node.js features aren't fully initialized yet.
- Lazy loading: We do NOT require heavy modules until we confirm VFS
  exists. This is critical -- loading loader.js/fs_shim.js would pull
  in ~72 modules, wasting startup time for normal (non-SEA) binaries.
- internalBinding: A Node.js-internal way to call C++ code. It's like
  require() but for native C++ modules. Not available to user code.
- fs shim: A wrapper around Node's `fs` module that intercepts file
  operations and redirects /snapshot/\* paths to the VFS.

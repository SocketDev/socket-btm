# fs.js -- Unified VFS API (the main internal interface)

## What This File Does

This is the "heart" of the VFS -- it provides a Node.js fs-compatible API
for reading files from the embedded TAR archive. It implements functions
like readFileSync(), statSync(), readdirSync(), openSync(), and
createReadStream() that work on virtual paths (e.g., '/snapshot/app.js').

It also provides file descriptor (FD) operations. Since VFS files live in
memory (not on disk), openSync() first extracts the file to a temporary
location, then opens a real kernel file descriptor on the extracted copy.
This allows VFS files to work with any code that expects real FDs.

## How It Fits in the VFS System

smol-vfs.js (public API) -> THIS FILE (fs.js)
-> loader.js (VFS map and path resolution)
-> tar_parser.js (TAR parsing)
-> smol/mount.js (file extraction)

This file is the layer between the public API (smol-vfs.js) and the
lower-level modules. It adds error handling, path normalization,
symlink resolution, and the fs-compatible interface.

## Key Concepts

- VFS prefix: Virtual paths start with a configurable prefix (default
  '/snapshot'). Example: '/snapshot/node_modules/lodash/index.js'
- Extract-on-demand: Files are only extracted from the archive when
  needed (e.g., when openSync() needs a real FD, or mount() is called).
- File descriptors: Numbers that the OS uses to track open files.
  When you call fs.openSync(), the OS gives you a number (like 3, 4, 5)
  that you use with readSync()/closeSync(). VFS wraps this by extracting
  the file first, then opening a real FD on the extracted copy.
- Symlinks in VFS: TAR archives can contain symbolic links. VFS resolves
  them with a depth limit (MAX_SYMLINK_DEPTH = 32) to prevent infinite loops.
- Primordials: Safe references to built-in methods (like Array.prototype.push)
  captured before any user code runs. This protects against prototype
  pollution attacks where malicious code modifies Array.prototype.

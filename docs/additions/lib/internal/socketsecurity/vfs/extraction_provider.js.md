# extraction_provider.js -- Strategies for extracting VFS files to real disk

## What This File Does

The VFS stores files in memory (inside the binary), but some operations
need files on the REAL filesystem. For example:

- Native addons (.node files) must be loaded via dlopen(), which needs
  a real file path.
- File descriptors (fd) from openSync() must point to real kernel files.
- Some third-party code expects real paths it can pass to child processes.

This file provides three "extraction providers" -- different strategies for
where to put these extracted files:

1. OnDiskExtractionProvider: Writes to ~/.socket/\_dlx/<hash>/
   Persistent across runs. Good for development (files survive restart).
2. InMemoryExtractionProvider: Writes to a temp directory (/tmp/vfs-xxx/).
   Deleted when the process exits. Good for production/read-only systems.
3. NoopProvider: Does nothing. Used when VFS is in "compat" mode (disabled).

## How It Fits in the VFS System

smol/mount.js -> THIS FILE (extraction_provider.js)
-> creates the appropriate provider based on VFS config mode
-> provider.extract(path, entry) writes the file and returns the real path
-> provider.getExtracted(path) checks if already extracted (cache hit)

## Key Concepts

- Provider pattern: An interface (getExtracted, extract, getCacheStats)
  implemented by multiple classes with different behaviors. The rest of
  the code doesn't care which provider is active -- it just calls
  provider.extract() and gets back a real filesystem path.

- Extraction: Copying a file from the in-memory VFS map to the real
  filesystem. The extracted file is a normal file that the OS can open,
  mmap, dlopen, etc.

- Symlink security: When extracting symlinks, the target is validated
  to prevent path traversal attacks (e.g., a symlink pointing to
  '../../etc/passwd' escaping the extraction directory).

- TOCTOU protection: "Time of check to time of use" -- even if a cached
  extraction path exists in memory, we re-check that the file still
  exists on disk before returning it (it might have been deleted).

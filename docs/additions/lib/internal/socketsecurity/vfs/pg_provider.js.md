# pg_provider.js -- PostgreSQL-backed virtual filesystem storage

## What This File Does

Implements a complete read/write virtual filesystem stored in a PostgreSQL
database. Instead of files living on disk or in a TAR archive, they live
as rows in a `vfs_entries` table. This lets you share a virtual filesystem
across multiple processes or machines via a shared database.

The API mirrors Node.js `fs/promises` -- readFile, writeFile, stat, readdir,
mkdir, unlink, rename, symlink, readlink. All methods are async because
PostgreSQL uses asynchronous network queries.

## How It Fits in the VFS System

This is a STANDALONE provider -- it does NOT read from the embedded TAR
archive. Instead, it's an alternative storage backend accessible via:

```js
const { SmolPgProvider } = require('node:smol-vfs')
const vfs = new SmolPgProvider('postgres://user:pass@host/db')
const content = await vfs.readFile('/app/config.json')
```

It's lazy-loaded (only imported when you access SmolPgProvider) to avoid
pulling in PostgreSQL infrastructure unless needed.

## Key Concepts

- Provider pattern: Like the extraction providers, this is a self-contained
  class with a well-defined API. You can swap SQLite for PostgreSQL by
  changing which provider you instantiate.

- Database schema: One table `vfs_entries` with columns:
  path (PRIMARY KEY), parent_path, name, type (0=file, 1=dir, 2=symlink),
  content (BYTEA), link_target, mode, mtime_ms, ctime_ms, birthtime_ms
  Directories are stored as rows too, with parent_path enabling efficient
  directory listings via indexed queries.

- Symlink resolution: readFile and stat follow symlinks (up to 40 levels
  deep) by recursively looking up link targets. lstat returns the symlink
  itself without following.

- Auto-creating parents: writeFile('/a/b/c.txt', data) automatically
  creates directories '/' and '/a' and '/a/b' if they don't exist,
  similar to `mkdir -p`.

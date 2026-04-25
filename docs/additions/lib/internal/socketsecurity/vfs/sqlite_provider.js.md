# sqlite_provider.js -- SQLite-backed virtual filesystem storage

## What This File Does

Implements a complete read/write virtual filesystem stored in a SQLite
database. This is the synchronous counterpart to pg_provider.js -- same
concept, but using Node.js's built-in SQLite (DatabaseSync) instead of
PostgreSQL. All methods are synchronous, matching the fs sync API:
readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, etc.

SQLite databases are single files, so this is useful for:

- Local development (a .sqlite file on disk)
- Testing (`:memory:` for an ephemeral in-memory filesystem)
- Embedding a writable filesystem in a single file

## How It Fits in the VFS System

This is a STANDALONE provider -- it does NOT read from the embedded TAR
archive. Instead, it's an alternative storage backend accessible via:

```js
const { SmolSqliteProvider } = require('node:smol-vfs')
const vfs = new SmolSqliteProvider(':memory:')
vfs.writeFileSync('/config.json', '{"key": "value"}')
const content = vfs.readFileSync('/config.json')
```

It's lazy-loaded (only imported when you access SmolSqliteProvider) to avoid
pulling in SQLite infrastructure unless needed.

## Key Concepts

- Prepared statements: SQL queries are compiled once (db.prepare()) and
  reused with different parameters. This is much faster than compiling
  the same SQL string on every call. The [kStmts] object caches all
  frequently used statements.

- WAL mode: "Write-Ahead Logging" -- a SQLite optimization that allows
  concurrent reads while a write is happening. Set via PRAGMA journal_mode=WAL.

- Database schema: Identical to pg_provider.js -- one table `vfs_entries` with
  the same columns. path is the PRIMARY KEY, parent_path is indexed for
  fast directory listings.

- Symlink resolution: Same as pg_provider -- follows symlinks up to 40 levels
  deep. lstatSync returns the symlink itself without following.

- Auto-creating parents: writeFileSync('/a/b/c.txt', data) automatically
  creates all parent directories, similar to `mkdir -p`.

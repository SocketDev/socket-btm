'use strict'

/**
 * Socket Security: VFS PostgreSQL Storage Provider
 *
 * A virtual filesystem storage provider backed by PostgreSQL using the
 * node:smol-sql infrastructure (internal PostgreSQL adapter with libpq bindings).
 *
 * All operations are async because the PostgreSQL adapter uses asynchronous
 * native bindings. Methods use async names (readFile, writeFile, etc.)
 * matching the fs promises API surface.
 *
 * IMPORTANT: This file runs during early bootstrap. Use
 * require('internal/socketsecurity/...') paths, NOT require('node:smol-sql').
 */

const {
  ArrayPrototypePush,
  Date: DateCtor,
  Error: ErrorCtor,
  MathCeil,
  Number: NumberCtor,
  ObjectFreeze,
  StringPrototypeEndsWith,
  StringPrototypeSlice,
  Symbol: SymbolCtor,
} = primordials

const {
  BufferFrom,
  PathBasename,
  PathDirname,
} = require('internal/socketsecurity/safe-references')

// Entry type constants matching the schema.
const TYPE_FILE = 0
const TYPE_DIRECTORY = 1
const TYPE_SYMLINK = 2

// Default file mode (0o644).
const DEFAULT_FILE_MODE = 420
// Default directory mode (0o755).
const DEFAULT_DIR_MODE = 493

// Symbols for internal state.
const kAdapter = SymbolCtor('kAdapter')
const kClosed = SymbolCtor('kClosed')
const kInitialized = SymbolCtor('kInitialized')
const kInitPromise = SymbolCtor('kInitPromise')

/**
 * Normalize a VFS path: ensure leading slash, no trailing slash (except root).
 *
 * @param {string} p - Path to normalize
 * @returns {string} Normalized path
 */
function normalizePath(p) {
  if (p === '' || p === '/') {
    return '/'
  }
  let result = p
  if (result[0] !== '/') {
    result = `/${result}`
  }
  if (result.length > 1 && StringPrototypeEndsWith(result, '/')) {
    result = StringPrototypeSlice(result, 0, -1)
  }
  return result
}

/**
 * Get the parent path of a given path.
 *
 * @param {string} p - Normalized path
 * @returns {string} Parent path
 */
function parentPath(p) {
  if (p === '/') {
    return '/'
  }
  const dir = PathDirname(p)
  return dir === '.' ? '/' : dir
}

/**
 * Create a stat-like object from a database row.
 *
 * @param {object} row - Database row
 * @returns {object} Stat-like object
 */
function rowToStat(row) {
  const isDir = row.type === TYPE_DIRECTORY
  const isLink = row.type === TYPE_SYMLINK
  const size = isDir ? 0 : (row.content ? row.content.length : 0)
  const mode = row.mode ?? (isDir ? DEFAULT_DIR_MODE : DEFAULT_FILE_MODE)
  const mtimeMs = NumberCtor(row.mtime_ms) || 0
  const ctimeMs = NumberCtor(row.ctime_ms) || 0
  const birthtimeMs = NumberCtor(row.birthtime_ms) || 0
  const mtime = new DateCtor(mtimeMs)
  const ctime = new DateCtor(ctimeMs)
  const birthtime = new DateCtor(birthtimeMs)

  const statFalse = () => false
  const statTrue = () => true

  return {
    __proto__: null,
    dev: 0,
    ino: 0,
    mode,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    blksize: 512,
    blocks: MathCeil(size / 512),
    atimeMs: mtimeMs,
    mtimeMs,
    ctimeMs,
    birthtimeMs,
    atime: mtime,
    mtime,
    ctime,
    birthtime,
    isFile: isDir || isLink ? statFalse : statTrue,
    isDirectory: isDir ? statTrue : statFalse,
    isBlockDevice: statFalse,
    isCharacterDevice: statFalse,
    isFIFO: statFalse,
    isSocket: statFalse,
    isSymbolicLink: isLink ? statTrue : statFalse,
  }
}

/**
 * Create a dirent-like object from a database row.
 *
 * @param {object} row - Database row
 * @returns {object} Dirent-like object
 */
function rowToDirent(row) {
  const isDir = row.type === TYPE_DIRECTORY
  const isLink = row.type === TYPE_SYMLINK

  const statFalse = () => false
  const statTrue = () => true

  return {
    __proto__: null,
    name: row.name,
    isFile: isDir || isLink ? statFalse : statTrue,
    isDirectory: isDir ? statTrue : statFalse,
    isBlockDevice: statFalse,
    isCharacterDevice: statFalse,
    isFIFO: statFalse,
    isSocket: statFalse,
    isSymbolicLink: isLink ? statTrue : statFalse,
  }
}

/**
 * Create an ENOENT error.
 *
 * @param {string} syscall - System call name
 * @param {string} path - Path that was not found
 * @returns {Error}
 */
function enoent(syscall, path) {
  const err = new ErrorCtor(
    `ENOENT: no such file or directory, ${syscall} '${path}'`,
  )
  err.code = 'ENOENT'
  err.errno = -2
  err.syscall = syscall
  err.path = path
  return err
}

/**
 * Create an EEXIST error.
 *
 * @param {string} syscall - System call name
 * @param {string} path - Path that already exists
 * @returns {Error}
 */
function eexist(syscall, path) {
  const err = new ErrorCtor(
    `EEXIST: file already exists, ${syscall} '${path}'`,
  )
  err.code = 'EEXIST'
  err.errno = -17
  err.syscall = syscall
  err.path = path
  return err
}

/**
 * Create an ENOTDIR error.
 *
 * @param {string} syscall - System call name
 * @param {string} path - Path that is not a directory
 * @returns {Error}
 */
function enotdir(syscall, path) {
  const err = new ErrorCtor(
    `ENOTDIR: not a directory, ${syscall} '${path}'`,
  )
  err.code = 'ENOTDIR'
  err.errno = -20
  err.syscall = syscall
  err.path = path
  return err
}

/**
 * Create an EISDIR error.
 *
 * @param {string} syscall - System call name
 * @param {string} path - Path that is a directory
 * @returns {Error}
 */
function eisdir(syscall, path) {
  const err = new ErrorCtor(
    `EISDIR: illegal operation on a directory, ${syscall} '${path}'`,
  )
  err.code = 'EISDIR'
  err.errno = -21
  err.syscall = syscall
  err.path = path
  return err
}

/**
 * Create an EINVAL error.
 *
 * @param {string} syscall - System call name
 * @param {string} path - Path
 * @returns {Error}
 */
function einval(syscall, path) {
  const err = new ErrorCtor(
    `EINVAL: invalid argument, ${syscall} '${path}'`,
  )
  err.code = 'EINVAL'
  err.errno = -22
  err.syscall = syscall
  err.path = path
  return err
}

/**
 * PostgreSQL-backed VFS storage provider.
 *
 * Provides an async fs-like API backed by a PostgreSQL database.
 * Uses the internal PostgreSQL adapter with libpq native bindings.
 *
 * All operations are async because PostgreSQL queries use asynchronous
 * native bindings. Methods use async names (readFile, writeFile, etc.)
 * matching the fs promises API surface.
 */
class SmolPgProvider {
  [kAdapter]
  [kClosed] = false
  [kInitialized] = false
  [kInitPromise] = undefined

  /**
   * Create a new PostgreSQL VFS provider.
   *
   * @param {string} url - PostgreSQL connection URL.
   *   Format: postgres://user:pass@host:port/database?params
   * @param {object} [options] - Additional adapter options
   */
  constructor(url, options) {
    let pgAdapter
    // Lazy-load the adapter.
    pgAdapter = require('internal/socketsecurity/sql/adapters/postgres')

    const config = {
      __proto__: null,
      url,
      min: 1,
      max: 5,
      ...(options || {}),
    }
    this[kAdapter] = pgAdapter.create(config)
  }

  /**
   * Execute a query and return rows.
   *
   * @param {string} text - SQL query with $1, $2, ... placeholders
   * @param {any[]} values - Parameter values
   * @returns {Promise<object[]>} Result rows
   */
  async #query(text, values) {
    const { result } = await this[kAdapter].query(text, values, 'objects')
    return result
  }

  /**
   * Execute a non-SELECT query.
   *
   * @param {string} text - SQL query
   * @param {any[]} values - Parameter values
   * @returns {Promise<void>}
   */
  async #exec(text, values) {
    await this[kAdapter].query(text, values, 'objects')
  }

  /**
   * Ensure the schema is initialized.
   *
   * @returns {Promise<void>}
   */
  async #ensureInit() {
    if (this[kClosed]) {
      throw new ErrorCtor('SmolPgProvider: connection is closed')
    }
    if (this[kInitialized]) {
      return
    }
    if (this[kInitPromise] !== undefined) {
      return this[kInitPromise]
    }
    this[kInitPromise] = this.#doInit()
    try {
      await this[kInitPromise]
    } finally {
      this[kInitPromise] = undefined
    }
  }

  /**
   * Initialize the database schema.
   *
   * @returns {Promise<void>}
   */
  async #doInit() {
    if (this[kInitialized]) {
      return
    }
    await this.#exec(
      'CREATE TABLE IF NOT EXISTS vfs_entries (' +
        'path TEXT PRIMARY KEY,' +
        'parent_path TEXT,' +
        'name TEXT NOT NULL,' +
        'type INTEGER NOT NULL,' +
        'content BYTEA,' +
        'link_target TEXT,' +
        'mode INTEGER NOT NULL DEFAULT 420,' +
        'mtime_ms DOUBLE PRECISION NOT NULL,' +
        'ctime_ms DOUBLE PRECISION NOT NULL,' +
        'birthtime_ms DOUBLE PRECISION NOT NULL' +
      ')',
      [],
    )
    await this.#exec(
      'CREATE INDEX IF NOT EXISTS idx_vfs_parent ON vfs_entries(parent_path)',
      [],
    )
    this[kInitialized] = true
  }

  /**
   * Get a row by path from the database.
   *
   * @param {string} p - Normalized path
   * @returns {Promise<object|undefined>} Row or undefined
   */
  async #getRow(p) {
    const rows = await this.#query(
      'SELECT * FROM vfs_entries WHERE path = $1',
      [p],
    )
    return rows.length > 0 ? rows[0] : undefined
  }

  /**
   * Follow symlinks to resolve the final entry.
   *
   * @param {string} p - Normalized path
   * @param {number} [maxDepth=40] - Maximum symlink depth
   * @returns {Promise<object|undefined>} Resolved row or undefined
   */
  async #resolve(p, maxDepth = 40) {
    let current = p
    for (let i = 0; i < maxDepth; i++) {
      const row = await this.#getRow(current)
      if (!row) {
        return undefined
      }
      if (row.type !== TYPE_SYMLINK) {
        return row
      }
      const dir = parentPath(current)
      const target = row.link_target
      if (target[0] === '/') {
        current = normalizePath(target)
      } else {
        current = normalizePath(`${dir}/${target}`)
      }
    }
    const err = new ErrorCtor(`ELOOP: too many levels of symbolic links, stat '${p}'`)
    err.code = 'ELOOP'
    err.errno = -40
    err.syscall = 'stat'
    err.path = p
    throw err
  }

  /**
   * Ensure all parent directories exist for a given path.
   *
   * @param {string} p - Normalized path
   * @param {number} now - Current timestamp
   * @returns {Promise<void>}
   */
  async #ensureParents(p, now) {
    const pp = parentPath(p)
    if (pp === '/' || pp === p) {
      const rootRow = await this.#getRow('/')
      if (!rootRow) {
        await this.#exec(
          'INSERT INTO vfs_entries (path, parent_path, name, type, content, link_target, mode, mtime_ms, ctime_ms, birthtime_ms) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (path) DO NOTHING',
          ['/', undefined, '', TYPE_DIRECTORY, undefined, undefined, DEFAULT_DIR_MODE, now, now, now],
        )
      }
      return
    }

    // Collect ancestors that need creation.
    const toCreate = []
    let current = pp
    while (current !== '/') {
      const row = await this.#getRow(current)
      if (row) {
        break
      }
      ArrayPrototypePush(toCreate, current)
      current = parentPath(current)
    }

    // Ensure root.
    await this.#exec(
      'INSERT INTO vfs_entries (path, parent_path, name, type, content, link_target, mode, mtime_ms, ctime_ms, birthtime_ms) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (path) DO NOTHING',
      ['/', undefined, '', TYPE_DIRECTORY, undefined, undefined, DEFAULT_DIR_MODE, now, now, now],
    )

    // Create ancestors from top to bottom (reverse order).
    for (let i = toCreate.length - 1; i >= 0; i--) {
      const dir = toCreate[i]
      await this.#exec(
        'INSERT INTO vfs_entries (path, parent_path, name, type, content, link_target, mode, mtime_ms, ctime_ms, birthtime_ms) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (path) DO NOTHING',
        [dir, parentPath(dir), PathBasename(dir), TYPE_DIRECTORY, undefined, undefined, DEFAULT_DIR_MODE, now, now, now],
      )
    }
  }

  /**
   * Read file contents.
   *
   * @param {string} path - File path
   * @returns {Promise<Buffer>} File contents
   * @throws {Error} ENOENT if not found, EISDIR if directory
   */
  async readFile(path) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const row = await this.#resolve(p)
    if (!row) {
      throw enoent('open', path)
    }
    if (row.type === TYPE_DIRECTORY) {
      throw eisdir('read', path)
    }
    return row.content ? BufferFrom(row.content) : BufferFrom('')
  }

  /**
   * Write file contents. Creates parent directories as needed.
   *
   * @param {string} path - File path
   * @param {Buffer|string|Uint8Array} data - Data to write
   * @returns {Promise<void>}
   */
  async writeFile(path, data) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const now = DateCtor.now()
    const content = typeof data === 'string' ? BufferFrom(data, 'utf8') : data

    await this.#ensureParents(p, now)

    const existing = await this.#getRow(p)
    if (existing) {
      if (existing.type === TYPE_DIRECTORY) {
        throw eisdir('open', path)
      }
      await this.#exec(
        'UPDATE vfs_entries SET content = $1, mtime_ms = $2, ctime_ms = $3 WHERE path = $4',
        [content, now, now, p],
      )
    } else {
      await this.#exec(
        'INSERT INTO vfs_entries (path, parent_path, name, type, content, link_target, mode, mtime_ms, ctime_ms, birthtime_ms) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [p, parentPath(p), PathBasename(p), TYPE_FILE, content, undefined, DEFAULT_FILE_MODE, now, now, now],
      )
    }
  }

  /**
   * Check if a path exists.
   *
   * @param {string} path - Path to check
   * @returns {Promise<boolean>}
   */
  async exists(path) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const rows = await this.#query(
      'SELECT 1 FROM vfs_entries WHERE path = $1 LIMIT 1',
      [p],
    )
    return rows.length > 0
  }

  /**
   * Get file stats (follows symlinks).
   *
   * @param {string} path - File path
   * @returns {Promise<object>} Stat-like object
   * @throws {Error} ENOENT if not found
   */
  async stat(path) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const row = await this.#resolve(p)
    if (!row) {
      throw enoent('stat', path)
    }
    return rowToStat(row)
  }

  /**
   * Get file stats (does NOT follow symlinks).
   *
   * @param {string} path - File path
   * @returns {Promise<object>} Stat-like object
   * @throws {Error} ENOENT if not found
   */
  async lstat(path) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const row = await this.#getRow(p)
    if (!row) {
      throw enoent('lstat', path)
    }
    return rowToStat(row)
  }

  /**
   * Read directory contents.
   *
   * @param {string} path - Directory path
   * @param {object} [options] - Options
   * @param {boolean} [options.withFileTypes] - Return dirent objects
   * @returns {Promise<string[]|object[]>} Directory entries
   * @throws {Error} ENOENT if not found, ENOTDIR if not a directory
   */
  async readdir(path, options) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const row = await this.#resolve(p)
    if (!row) {
      throw enoent('scandir', path)
    }
    if (row.type !== TYPE_DIRECTORY) {
      throw enotdir('scandir', path)
    }

    const children = await this.#query(
      'SELECT * FROM vfs_entries WHERE parent_path = $1',
      [row.path],
    )
    const withFileTypes = options?.withFileTypes ?? false

    if (withFileTypes) {
      const result = []
      for (let i = 0, len = children.length; i < len; i++) {
        ArrayPrototypePush(result, rowToDirent(children[i]))
      }
      return result
    }

    const result = []
    for (let i = 0, len = children.length; i < len; i++) {
      ArrayPrototypePush(result, children[i].name)
    }
    return result
  }

  /**
   * Create a directory.
   *
   * @param {string} path - Directory path
   * @param {object} [options] - Options
   * @param {boolean} [options.recursive] - Create parent directories
   * @returns {Promise<void>}
   * @throws {Error} ENOENT if parent missing (non-recursive), EEXIST if exists
   */
  async mkdir(path, options) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const recursive = options?.recursive ?? false
    const now = DateCtor.now()

    if (recursive) {
      await this.#ensureParents(p, now)
      await this.#mkdirOne(p, now)
      return
    }

    // Non-recursive: parent must exist.
    const pp = parentPath(p)
    if (pp !== '/' && pp !== p) {
      const parentRow = await this.#getRow(pp)
      if (!parentRow) {
        throw enoent('mkdir', path)
      }
      if (parentRow.type !== TYPE_DIRECTORY) {
        throw enotdir('mkdir', path)
      }
    }

    const existing = await this.#getRow(p)
    if (existing) {
      throw eexist('mkdir', path)
    }

    await this.#mkdirOne(p, now)
  }

  /**
   * Remove a file or symlink.
   *
   * @param {string} path - Path to remove
   * @returns {Promise<void>}
   * @throws {Error} ENOENT if not found, EISDIR if directory
   */
  async unlink(path) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const row = await this.#getRow(p)
    if (!row) {
      throw enoent('unlink', path)
    }
    if (row.type === TYPE_DIRECTORY) {
      throw eisdir('unlink', path)
    }
    await this.#exec('DELETE FROM vfs_entries WHERE path = $1', [p])
  }

  /**
   * Rename a file or directory.
   *
   * @param {string} oldPath - Current path
   * @param {string} newPath - New path
   * @returns {Promise<void>}
   * @throws {Error} ENOENT if source not found
   */
  async rename(oldPath, newPath) {
    await this.#ensureInit()
    const op = normalizePath(oldPath)
    const np = normalizePath(newPath)
    const now = DateCtor.now()

    const row = await this.#getRow(op)
    if (!row) {
      throw enoent('rename', oldPath)
    }

    // Ensure new parent exists.
    await this.#ensureParents(np, now)

    // Remove anything at the destination (and children).
    await this.#exec(
      "DELETE FROM vfs_entries WHERE path = $1 OR path LIKE $1 || '/%'",
      [np],
    )

    // Rename the entry itself.
    await this.#exec(
      'UPDATE vfs_entries SET path = $1, parent_path = $2, name = $3, mtime_ms = $4, ctime_ms = $5 WHERE path = $6',
      [np, parentPath(np), PathBasename(np), now, now, op],
    )

    // If it's a directory, update all children paths.
    if (row.type === TYPE_DIRECTORY) {
      const children = await this.#query(
        "SELECT path FROM vfs_entries WHERE path LIKE $1 || '/%'",
        [op],
      )
      for (let i = 0, len = children.length; i < len; i++) {
        const childOldPath = children[i].path
        const childNewPath = np + StringPrototypeSlice(childOldPath, op.length)
        const childParent = parentPath(childNewPath)
        const childName = PathBasename(childNewPath)
        await this.#exec(
          'UPDATE vfs_entries SET path = $1, parent_path = $2, name = $3, mtime_ms = $4, ctime_ms = $5 WHERE path = $6',
          [childNewPath, childParent, childName, now, now, childOldPath],
        )
      }
    }
  }

  /**
   * Create a symbolic link.
   *
   * @param {string} target - Link target
   * @param {string} path - Symlink path
   * @returns {Promise<void>}
   * @throws {Error} EEXIST if path already exists
   */
  async symlink(target, path) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const now = DateCtor.now()

    const existing = await this.#getRow(p)
    if (existing) {
      throw eexist('symlink', path)
    }

    await this.#ensureParents(p, now)

    await this.#exec(
      'INSERT INTO vfs_entries (path, parent_path, name, type, content, link_target, mode, mtime_ms, ctime_ms, birthtime_ms) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [p, parentPath(p), PathBasename(p), TYPE_SYMLINK, undefined, target, 0o120777, now, now, now],
    )
  }

  /**
   * Read the target of a symbolic link.
   *
   * @param {string} path - Symlink path
   * @returns {Promise<string>} Link target
   * @throws {Error} ENOENT if not found, EINVAL if not a symlink
   */
  async readlink(path) {
    await this.#ensureInit()
    const p = normalizePath(path)
    const row = await this.#getRow(p)
    if (!row) {
      throw enoent('readlink', path)
    }
    if (row.type !== TYPE_SYMLINK) {
      throw einval('readlink', path)
    }
    return row.link_target
  }

  /**
   * Close the database connection.
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (this[kClosed]) {
      return
    }
    this[kClosed] = true
    await this[kAdapter].close()
  }

  /**
   * Create a single directory entry if it doesn't already exist.
   *
   * @param {string} p - Normalized path
   * @param {number} now - Current timestamp
   * @returns {Promise<void>}
   */
  async #mkdirOne(p, now) {
    const existing = await this.#getRow(p)
    if (existing) {
      if (existing.type === TYPE_DIRECTORY) {
        return
      }
      throw eexist('mkdir', p)
    }
    await this.#exec(
      'INSERT INTO vfs_entries (path, parent_path, name, type, content, link_target, mode, mtime_ms, ctime_ms, birthtime_ms) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [p, parentPath(p), PathBasename(p), TYPE_DIRECTORY, undefined, undefined, DEFAULT_DIR_MODE, now, now, now],
    )
  }
}

module.exports = ObjectFreeze({
  __proto__: null,
  SmolPgProvider,
})

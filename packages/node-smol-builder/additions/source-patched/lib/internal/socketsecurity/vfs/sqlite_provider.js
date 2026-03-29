'use strict'

/**
 * Socket Security: VFS SQLite Storage Provider
 *
 * A virtual filesystem storage provider backed by SQLite using the built-in
 * node:sqlite DatabaseSync. All operations are synchronous, matching the
 * standard fs sync API surface.
 *
 * IMPORTANT: This file runs during early bootstrap. Use require('sqlite')
 * not require('node:sqlite') - the node: protocol isn't available at this stage.
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
const kDb = SymbolCtor('kDb')
const kClosed = SymbolCtor('kClosed')
const kStmts = SymbolCtor('kStmts')

// Native SQLite binding - loaded lazily.
let DatabaseSync

function getDatabase() {
  if (!DatabaseSync) {
    const sqlite = require('sqlite')
    DatabaseSync = sqlite.DatabaseSync
  }
  return DatabaseSync
}

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
  // Ensure leading slash.
  let result = p
  if (result[0] !== '/') {
    result = `/${result}`
  }
  // Remove trailing slash.
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
  const size = isDir ? 0 : row.content ? row.content.length : 0
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
  const err = new ErrorCtor(`EEXIST: file already exists, ${syscall} '${path}'`)
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
  const err = new ErrorCtor(`ENOTDIR: not a directory, ${syscall} '${path}'`)
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
  const err = new ErrorCtor(`EINVAL: invalid argument, ${syscall} '${path}'`)
  err.code = 'EINVAL'
  err.errno = -22
  err.syscall = syscall
  err.path = path
  return err
}

/**
 * SQLite-backed VFS storage provider.
 *
 * Provides a synchronous fs-like API backed by a SQLite database.
 * Uses the built-in node:sqlite DatabaseSync for all operations.
 */
class SmolSqliteProvider {
  [kDb];
  [kClosed] = (false[kStmts] = { __proto__: null })

  /**
   * Create a new SQLite VFS provider.
   *
   * @param {string} [urlOrPath] - SQLite connection URL or file path.
   *   Defaults to ':memory:'. Supports 'sqlite://', 'file://', or plain paths.
   */
  constructor(urlOrPath) {
    let filename
    if (urlOrPath === undefined || urlOrPath === ':memory:') {
      filename = ':memory:'
    } else if (StringPrototypeSlice(urlOrPath, 0, 9) === 'sqlite://') {
      filename = StringPrototypeSlice(urlOrPath, 9)
    } else if (StringPrototypeSlice(urlOrPath, 0, 7) === 'file://') {
      filename = StringPrototypeSlice(urlOrPath, 7)
    } else {
      filename = urlOrPath
    }

    const Database = getDatabase()
    this[kDb] = new Database(filename, {
      open: true,
      enableForeignKeyConstraints: true,
    })

    // Performance pragmas.
    this[kDb].exec('PRAGMA journal_mode=WAL')
    this[kDb].exec('PRAGMA synchronous=NORMAL')
    this[kDb].exec('PRAGMA busy_timeout=5000')
    this[kDb].exec('PRAGMA cache_size=-64000')

    // Create schema.
    this[kDb].exec(
      'CREATE TABLE IF NOT EXISTS vfs_entries (' +
        'path TEXT PRIMARY KEY,' +
        'parent_path TEXT,' +
        'name TEXT NOT NULL,' +
        'type INTEGER NOT NULL,' +
        'content BLOB,' +
        'link_target TEXT,' +
        'mode INTEGER NOT NULL DEFAULT 420,' +
        'mtime_ms REAL NOT NULL,' +
        'ctime_ms REAL NOT NULL,' +
        'birthtime_ms REAL NOT NULL' +
        ')',
    )
    this[kDb].exec(
      'CREATE INDEX IF NOT EXISTS idx_vfs_parent ON vfs_entries(parent_path)',
    )

    // Pre-compile frequently used statements.
    const db = this[kDb]
    const stmts = this[kStmts]
    stmts.getByPath = db.prepare('SELECT * FROM vfs_entries WHERE path = ?')
    stmts.existsByPath = db.prepare(
      'SELECT 1 FROM vfs_entries WHERE path = ? LIMIT 1',
    )
    stmts.listChildren = db.prepare(
      'SELECT * FROM vfs_entries WHERE parent_path = ?',
    )
    stmts.insert = db.prepare(
      'INSERT INTO vfs_entries (path, parent_path, name, type, content, link_target, mode, mtime_ms, ctime_ms, birthtime_ms) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    stmts.updateContent = db.prepare(
      'UPDATE vfs_entries SET content = ?, mtime_ms = ?, ctime_ms = ? WHERE path = ?',
    )
    stmts.deleteByPath = db.prepare('DELETE FROM vfs_entries WHERE path = ?')
    stmts.deleteByPrefix = db.prepare(
      "DELETE FROM vfs_entries WHERE path = ? OR path LIKE ? || '/%'",
    )
    stmts.renameSingle = db.prepare(
      'UPDATE vfs_entries SET path = ?, parent_path = ?, name = ?, mtime_ms = ?, ctime_ms = ? WHERE path = ?',
    )
    stmts.getByPrefix = db.prepare(
      "SELECT path FROM vfs_entries WHERE path LIKE ? || '/%'",
    )
  }

  /**
   * Ensure the database is open.
   * @throws {Error} If the database has been closed.
   */
  #ensureOpen() {
    if (this[kClosed]) {
      throw new ErrorCtor('SmolSqliteProvider: database is closed')
    }
  }

  /**
   * Get a row by path from the database.
   *
   * @param {string} p - Normalized path
   * @returns {object|undefined} Row or undefined
   */
  #getRow(p) {
    return this[kStmts].getByPath.get(p)
  }

  /**
   * Follow symlinks to resolve the final entry.
   *
   * @param {string} p - Normalized path
   * @param {number} [maxDepth=40] - Maximum symlink depth
   * @returns {object|undefined} Resolved row or undefined
   */
  #resolve(p, maxDepth = 40) {
    let current = p
    for (let i = 0; i < maxDepth; i++) {
      const row = this.#getRow(current)
      if (!row) {
        return undefined
      }
      if (row.type !== TYPE_SYMLINK) {
        return row
      }
      // Resolve symlink target relative to symlink's parent.
      const dir = parentPath(current)
      const target = row.link_target
      if (target[0] === '/') {
        current = normalizePath(target)
      } else {
        current = normalizePath(`${dir}/${target}`)
      }
    }
    // Too many levels of symlinks.
    const err = new ErrorCtor(
      `ELOOP: too many levels of symbolic links, stat '${p}'`,
    )
    err.code = 'ELOOP'
    err.errno = -40
    err.syscall = 'stat'
    err.path = p
    throw err
  }

  /**
   * Read file contents.
   *
   * @param {string} path - File path
   * @returns {Buffer} File contents
   * @throws {Error} ENOENT if not found, EISDIR if directory
   */
  readFileSync(path) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const row = this.#resolve(p)
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
   */
  writeFileSync(path, data) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const now = DateCtor.now()
    const content = typeof data === 'string' ? BufferFrom(data, 'utf8') : data

    // Ensure parent directories exist.
    this.#ensureParents(p, now)

    const existing = this.#getRow(p)
    if (existing) {
      if (existing.type === TYPE_DIRECTORY) {
        throw eisdir('open', path)
      }
      // Update existing file.
      this[kStmts].updateContent.run(content, now, now, p)
    } else {
      // Insert new file.
      this[kStmts].insert.run(
        p,
        parentPath(p),
        PathBasename(p),
        TYPE_FILE,
        content,
        undefined,
        DEFAULT_FILE_MODE,
        now,
        now,
        now,
      )
    }
  }

  /**
   * Check if a path exists.
   *
   * @param {string} path - Path to check
   * @returns {boolean}
   */
  existsSync(path) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const row = this[kStmts].existsByPath.get(p)
    return row !== undefined
  }

  /**
   * Get file stats (follows symlinks).
   *
   * @param {string} path - File path
   * @returns {object} Stat-like object
   * @throws {Error} ENOENT if not found
   */
  statSync(path) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const row = this.#resolve(p)
    if (!row) {
      throw enoent('stat', path)
    }
    return rowToStat(row)
  }

  /**
   * Get file stats (does NOT follow symlinks).
   *
   * @param {string} path - File path
   * @returns {object} Stat-like object
   * @throws {Error} ENOENT if not found
   */
  lstatSync(path) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const row = this.#getRow(p)
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
   * @returns {string[]|object[]} Directory entries
   * @throws {Error} ENOENT if not found, ENOTDIR if not a directory
   */
  readdirSync(path, options) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const row = this.#resolve(p)
    if (!row) {
      throw enoent('scandir', path)
    }
    if (row.type !== TYPE_DIRECTORY) {
      throw enotdir('scandir', path)
    }

    const children = this[kStmts].listChildren.all(row.path)
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
   * @throws {Error} ENOENT if parent missing (non-recursive), EEXIST if exists
   */
  mkdirSync(path, options) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const recursive = options?.recursive ?? false
    const now = DateCtor.now()

    if (recursive) {
      this.#ensureParents(p, now)
      this.#mkdirOne(p, now)
      return
    }

    // Non-recursive: parent must exist.
    const pp = parentPath(p)
    if (pp !== '/' && pp !== p) {
      const parentRow = this.#getRow(pp)
      if (!parentRow) {
        throw enoent('mkdir', path)
      }
      if (parentRow.type !== TYPE_DIRECTORY) {
        throw enotdir('mkdir', path)
      }
    }

    const existing = this.#getRow(p)
    if (existing) {
      throw eexist('mkdir', path)
    }

    this.#mkdirOne(p, now)
  }

  /**
   * Remove a file or symlink.
   *
   * @param {string} path - Path to remove
   * @throws {Error} ENOENT if not found, EISDIR if directory
   */
  unlinkSync(path) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const row = this.#getRow(p)
    if (!row) {
      throw enoent('unlink', path)
    }
    if (row.type === TYPE_DIRECTORY) {
      throw eisdir('unlink', path)
    }
    this[kStmts].deleteByPath.run(p)
  }

  /**
   * Rename a file or directory.
   *
   * @param {string} oldPath - Current path
   * @param {string} newPath - New path
   * @throws {Error} ENOENT if source not found
   */
  renameSync(oldPath, newPath) {
    this.#ensureOpen()
    const op = normalizePath(oldPath)
    const np = normalizePath(newPath)
    const now = DateCtor.now()

    const row = this.#getRow(op)
    if (!row) {
      throw enoent('rename', oldPath)
    }

    // Ensure new parent exists.
    this.#ensureParents(np, now)

    // Remove anything at the destination.
    this[kStmts].deleteByPrefix.run(np, np)

    // Rename the entry itself.
    this[kStmts].renameSingle.run(
      np,
      parentPath(np),
      PathBasename(np),
      now,
      now,
      op,
    )

    // If it's a directory, update all children paths.
    if (row.type === TYPE_DIRECTORY) {
      const children = this[kStmts].getByPrefix.all(op)
      for (let i = 0, len = children.length; i < len; i++) {
        const childOldPath = children[i].path
        const childNewPath = np + StringPrototypeSlice(childOldPath, op.length)
        const childParent = parentPath(childNewPath)
        const childName = PathBasename(childNewPath)
        this[kStmts].renameSingle.run(
          childNewPath,
          childParent,
          childName,
          now,
          now,
          childOldPath,
        )
      }
    }
  }

  /**
   * Create a symbolic link.
   *
   * @param {string} target - Link target
   * @param {string} path - Symlink path
   * @throws {Error} EEXIST if path already exists
   */
  symlinkSync(target, path) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const now = DateCtor.now()

    const existing = this.#getRow(p)
    if (existing) {
      throw eexist('symlink', path)
    }

    // Ensure parent directories exist.
    this.#ensureParents(p, now)

    this[kStmts].insert.run(
      p,
      parentPath(p),
      PathBasename(p),
      TYPE_SYMLINK,
      undefined,
      target,
      0o120777,
      now,
      now,
      now,
    )
  }

  /**
   * Read the target of a symbolic link.
   *
   * @param {string} path - Symlink path
   * @returns {string} Link target
   * @throws {Error} ENOENT if not found, EINVAL if not a symlink
   */
  readlinkSync(path) {
    this.#ensureOpen()
    const p = normalizePath(path)
    const row = this.#getRow(p)
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
   */
  close() {
    if (this[kClosed]) {
      return
    }
    this[kClosed] = true
    this[kDb].close()
    this[kDb] = undefined
  }

  /**
   * Create a single directory entry if it doesn't already exist.
   *
   * @param {string} p - Normalized path
   * @param {number} now - Current timestamp
   */
  #mkdirOne(p, now) {
    const existing = this.#getRow(p)
    if (existing) {
      if (existing.type === TYPE_DIRECTORY) {
        return
      }
      throw eexist('mkdir', p)
    }
    this[kStmts].insert.run(
      p,
      parentPath(p),
      PathBasename(p),
      TYPE_DIRECTORY,
      undefined,
      undefined,
      DEFAULT_DIR_MODE,
      now,
      now,
      now,
    )
  }

  /**
   * Ensure all parent directories exist for a given path.
   *
   * @param {string} p - Normalized path
   * @param {number} now - Current timestamp
   */
  #ensureParents(p, now) {
    const pp = parentPath(p)
    if (pp === '/' || pp === p) {
      // Ensure root exists.
      const rootRow = this.#getRow('/')
      if (!rootRow) {
        this[kStmts].insert.run(
          '/',
          undefined,
          '',
          TYPE_DIRECTORY,
          undefined,
          undefined,
          DEFAULT_DIR_MODE,
          now,
          now,
          now,
        )
      }
      return
    }

    // Collect ancestors that need creation.
    const toCreate = []
    let current = pp
    while (current !== '/') {
      const row = this.#getRow(current)
      if (row) {
        break
      }
      ArrayPrototypePush(toCreate, current)
      current = parentPath(current)
    }

    // Ensure root.
    const rootRow = this.#getRow('/')
    if (!rootRow) {
      this[kStmts].insert.run(
        '/',
        undefined,
        '',
        TYPE_DIRECTORY,
        undefined,
        undefined,
        DEFAULT_DIR_MODE,
        now,
        now,
        now,
      )
    }

    // Create ancestors from top to bottom (reverse order).
    for (let i = toCreate.length - 1; i >= 0; i--) {
      const dir = toCreate[i]
      this[kStmts].insert.run(
        dir,
        parentPath(dir),
        PathBasename(dir),
        TYPE_DIRECTORY,
        undefined,
        undefined,
        DEFAULT_DIR_MODE,
        now,
        now,
        now,
      )
    }
  }
}

module.exports = ObjectFreeze({
  __proto__: null,
  SmolSqliteProvider,
})

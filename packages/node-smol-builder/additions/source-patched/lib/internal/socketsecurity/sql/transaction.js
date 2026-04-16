'use strict'

// SQL Transaction Support
// Provides transaction and savepoint management.

const {
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  Error: ErrorCtor,
  FunctionPrototypeBind,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectHasOwn,
  ReflectApply,
  RegExpPrototypeExec,
  StringPrototypeToLowerCase,
  StringPrototypeToUpperCase,
  Symbol: SymbolCtor,
  SymbolToStringTag,
  WeakMapPrototypeGet,
  WeakMapPrototypeSet,
  hardenRegExp,
} = primordials

const { validateFunction, validateString } = require('internal/validators')
const {
  getTemplateCache,
  parseQuery,
} = require('internal/socketsecurity/sql/query')
const {
  SQLTransactionCommittedError,
  SQLTransactionRolledBackError,
  SQLTransactionNotStartedError,
} = require('internal/socketsecurity/sql/errors')

// Valid savepoint name pattern: must be SQL identifier (letters, digits, underscore, starts with letter/underscore)
// Security: prevents SQL injection in SAVEPOINT statements
const SAVEPOINT_NAME_REGEX = hardenRegExp(/^[a-zA-Z_][a-zA-Z0-9_]*$/)

/**
 * Validate savepoint name to prevent SQL injection.
 * @param {string} name - Savepoint name
 */
function validateSavepointName(name) {
  if (!RegExpPrototypeExec(SAVEPOINT_NAME_REGEX, name)) {
    throw new ErrorCtor(
      `Invalid savepoint name "${name}": must be a valid SQL identifier ` +
        '(start with letter or underscore, contain only letters, digits, underscores)',
    )
  }
}

const kAdapter = SymbolCtor('kAdapter')
const kConnection = SymbolCtor('kConnection')
const kOptions = SymbolCtor('kOptions')
const kState = SymbolCtor('kState')
const kSavepointCounter = SymbolCtor('kSavepointCounter')

const STATE_PENDING = 0
const STATE_ACTIVE = 1
const STATE_COMMITTED = 2
const STATE_ROLLED_BACK = 3

// Valid isolation levels (case-insensitive)
const VALID_ISOLATION_LEVELS = ObjectFreeze([
  'read uncommitted',
  'read committed',
  'repeatable read',
  'serializable',
])

/**
 * Validate transaction options.
 */
function validateTransactionOptions(opts) {
  if (opts.isolationLevel) {
    const level = StringPrototypeToLowerCase(opts.isolationLevel)
    if (!ArrayPrototypeIncludes(VALID_ISOLATION_LEVELS, level)) {
      throw new ErrorCtor(
        `Invalid isolationLevel: "${opts.isolationLevel}". ` +
          `Valid values: ${ArrayPrototypeJoin(VALID_ISOLATION_LEVELS, ', ')}`,
      )
    }
  }
}

/**
 * Transaction - Represents a database transaction.
 */
class Transaction {
  [kAdapter];
  [kConnection];
  [kOptions];
  [kState] = STATE_PENDING;
  [kSavepointCounter] = 0

  constructor(adapter, connection, options) {
    const opts = { __proto__: null, ...options }
    this[kAdapter] = adapter
    this[kConnection] = connection
    this[kOptions] = opts

    // Return a callable proxy for tagged template support.
    const self = this
    const handler = {
      __proto__: null,
      apply(target, thisArg, args) {
        return ReflectApply(self.#taggedTemplate, self, args)
      },
      get(target, prop, receiver) {
        // Use ObjectHasOwn to prevent prototype pollution attacks.
        if (
          ObjectHasOwn(self, prop) ||
          ObjectHasOwn(Transaction.prototype, prop)
        ) {
          const value = self[prop]
          if (typeof value === 'function') {
            return FunctionPrototypeBind(value, self)
          }
          return value
        }
        return undefined
      },
    }

    // eslint-disable-next-line no-constructor-return
    return new Proxy(function TransactionTaggedTemplate() {}, handler)
  }

  #taggedTemplate(strings, ...values) {
    this.#ensureActive()

    // Use template cache for performance (separate cache per paramStyle)
    const paramStyle = this[kAdapter].paramStyle
    const templateCache = getTemplateCache(paramStyle)
    let cached = WeakMapPrototypeGet(templateCache, strings)
    if (!cached) {
      cached = parseQuery(strings, paramStyle)
      WeakMapPrototypeSet(templateCache, strings, cached)
    }

    const { text, paramIndices } = cached
    const paramLen = paramIndices.length
    const queryValues = new Array(paramLen)
    for (let i = 0; i < paramLen; i++) {
      queryValues[i] = values[paramIndices[i]]
    }

    return this[kAdapter].queryOnConnection(
      this[kConnection],
      text,
      queryValues,
    )
  }

  #ensureActive() {
    if (this[kState] === STATE_PENDING) {
      throw new SQLTransactionNotStartedError()
    }
    if (this[kState] === STATE_COMMITTED) {
      throw new SQLTransactionCommittedError()
    }
    if (this[kState] === STATE_ROLLED_BACK) {
      throw new SQLTransactionRolledBackError()
    }
  }

  /**
   * Begin the transaction.
   * @returns {Promise<void>}
   */
  async begin() {
    if (this[kState] !== STATE_PENDING) {
      throw new ErrorCtor('Transaction already started')
    }

    const opts = this[kOptions]

    // Validate options before executing
    validateTransactionOptions(opts)

    let beginSQL = 'BEGIN'

    // Build BEGIN statement based on options.
    if (opts.isolationLevel) {
      beginSQL += ` ISOLATION LEVEL ${StringPrototypeToUpperCase(opts.isolationLevel)}`
    }
    if (opts.readOnly) {
      beginSQL += ' READ ONLY'
    }
    if (opts.deferrable) {
      beginSQL += ' DEFERRABLE'
    }

    await this[kAdapter].queryOnConnection(this[kConnection], beginSQL, [])
    this[kState] = STATE_ACTIVE
  }

  /**
   * Commit the transaction.
   * @returns {Promise<void>}
   */
  async commit() {
    this.#ensureActive()
    await this[kAdapter].queryOnConnection(this[kConnection], 'COMMIT', [])
    this[kState] = STATE_COMMITTED
  }

  /**
   * Rollback the transaction.
   * @returns {Promise<void>}
   */
  async rollback() {
    if (
      this[kState] === STATE_COMMITTED ||
      this[kState] === STATE_ROLLED_BACK
    ) {
      return // Already finished, nothing to rollback.
    }
    if (this[kState] === STATE_ACTIVE) {
      await this[kAdapter].queryOnConnection(this[kConnection], 'ROLLBACK', [])
    }
    this[kState] = STATE_ROLLED_BACK
  }

  /**
   * Create a savepoint for nested rollback.
   * @param {string|function} nameOrFn - Savepoint name or callback
   * @param {function} [fn] - Callback when name provided
   * @returns {Promise<any>}
   */
  async savepoint(nameOrFn, fn) {
    this.#ensureActive()

    let name
    let callback

    if (typeof nameOrFn === 'function') {
      callback = nameOrFn
      name = `sp_${++this[kSavepointCounter]}`
    } else {
      validateString(nameOrFn, 'name')
      validateFunction(fn, 'fn')
      // Security: validate user-provided name to prevent SQL injection
      validateSavepointName(nameOrFn)
      name = nameOrFn
      callback = fn
    }

    const sp = new Savepoint(this[kAdapter], this[kConnection], name)

    try {
      await sp.create()
      const result = await callback(sp)
      await sp.release()
      return result
    } catch (err) {
      await sp.rollback()
      throw err
    }
  }
}

ObjectDefineProperty(Transaction.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'Transaction',
})

/**
 * Savepoint - Represents a transaction savepoint.
 */
class Savepoint {
  [kAdapter];
  [kConnection]
  #name
  #released = false

  constructor(adapter, connection, name) {
    this[kAdapter] = adapter
    this[kConnection] = connection
    this.#name = name

    // Return a callable proxy for tagged template support.
    const self = this
    const handler = {
      __proto__: null,
      apply(target, thisArg, args) {
        return ReflectApply(self.#taggedTemplate, self, args)
      },
      get(target, prop, receiver) {
        // Use ObjectHasOwn to prevent prototype pollution attacks.
        if (
          ObjectHasOwn(self, prop) ||
          ObjectHasOwn(Savepoint.prototype, prop)
        ) {
          const value = self[prop]
          if (typeof value === 'function') {
            return FunctionPrototypeBind(value, self)
          }
          return value
        }
        return undefined
      },
    }

    // eslint-disable-next-line no-constructor-return
    return new Proxy(function SavepointTaggedTemplate() {}, handler)
  }

  #taggedTemplate(strings, ...values) {
    if (this.#released) {
      throw new SQLTransactionCommittedError()
    }

    // Use template cache for performance (separate cache per paramStyle)
    const paramStyle = this[kAdapter].paramStyle
    const templateCache = getTemplateCache(paramStyle)
    let cached = WeakMapPrototypeGet(templateCache, strings)
    if (!cached) {
      cached = parseQuery(strings, paramStyle)
      WeakMapPrototypeSet(templateCache, strings, cached)
    }

    const { text, paramIndices } = cached
    const paramLen = paramIndices.length
    const queryValues = new Array(paramLen)
    for (let i = 0; i < paramLen; i++) {
      queryValues[i] = values[paramIndices[i]]
    }

    return this[kAdapter].queryOnConnection(
      this[kConnection],
      text,
      queryValues,
    )
  }

  /**
   * Create the savepoint.
   * @returns {Promise<void>}
   */
  async create() {
    await this[kAdapter].queryOnConnection(
      this[kConnection],
      `SAVEPOINT ${this.#name}`,
      [],
    )
  }

  /**
   * Release the savepoint (commit changes since savepoint).
   * @returns {Promise<void>}
   */
  async release() {
    if (!this.#released) {
      await this[kAdapter].queryOnConnection(
        this[kConnection],
        `RELEASE SAVEPOINT ${this.#name}`,
        [],
      )
      // Set flag AFTER query succeeds to preserve state on error.
      this.#released = true
    }
  }

  /**
   * Rollback to the savepoint.
   * @returns {Promise<void>}
   */
  async rollback() {
    if (!this.#released) {
      await this[kAdapter].queryOnConnection(
        this[kConnection],
        `ROLLBACK TO SAVEPOINT ${this.#name}`,
        [],
      )
      // Set flag AFTER query succeeds to preserve state on error.
      this.#released = true
    }
  }
}

ObjectDefineProperty(Savepoint.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'Savepoint',
})

module.exports = {
  __proto__: null,
  Transaction,
  Savepoint,
}

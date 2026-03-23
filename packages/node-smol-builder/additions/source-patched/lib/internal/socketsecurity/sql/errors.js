'use strict';

// SQL Error Classes
// Provides database-specific error types.

const {
  Error: ErrorCtor,
  ErrorCaptureStackTrace,
  ObjectDefineProperty,
  ObjectSetPrototypeOf,
  RegExpPrototypeTest,
  Symbol: SymbolCtor,
  SymbolToStringTag,
  hardenRegExp,
} = primordials;

const ErrorProto = ErrorCtor.prototype;

// SQLite message patterns for error type detection.
// SQLite uses generic SQLITE_ERROR (1) for many errors, so we must inspect the message.
const SQLITE_SYNTAX_ERROR_REGEX = hardenRegExp(/syntax error/i);
const SQLITE_NO_SUCH_TABLE_REGEX = hardenRegExp(/no such table:/i);

/**
 * Base SQL error class.
 */
class SQLError extends ErrorCtor {
  constructor(message, options) {
    super(message);
    const opts = { __proto__: null, ...options };
    this.name = 'SQLError';
    this.code = opts.code;
    ErrorCaptureStackTrace(this, SQLError);
  }
}

ObjectSetPrototypeOf(SQLError.prototype, ErrorProto);
ObjectSetPrototypeOf(SQLError, ErrorCtor);

ObjectDefineProperty(SQLError.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'SQLError',
});

/**
 * PostgreSQL-specific error.
 * Contains detailed error information from libpq.
 */
class PostgresError extends SQLError {
  constructor(message, details) {
    const d = { __proto__: null, ...details };
    super(message, { __proto__: null, code: d.code });
    this.name = 'PostgresError';

    // PostgreSQL error fields.
    this.severity = d.severity;
    this.detail = d.detail;
    this.hint = d.hint;
    this.position = d.position;
    this.internalPosition = d.internalPosition;
    this.internalQuery = d.internalQuery;
    this.where = d.where;
    this.schema = d.schema;
    this.table = d.table;
    this.column = d.column;
    this.dataType = d.dataType;
    this.constraint = d.constraint;
    this.file = d.file;
    this.line = d.line;
    this.routine = d.routine;

    ErrorCaptureStackTrace(this, PostgresError);
  }
}

ObjectSetPrototypeOf(PostgresError.prototype, SQLError.prototype);
ObjectSetPrototypeOf(PostgresError, SQLError);

ObjectDefineProperty(PostgresError.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'PostgresError',
});

/**
 * SQLite-specific error.
 */
class SQLiteError extends SQLError {
  constructor(message, details) {
    const d = { __proto__: null, ...details };
    super(message, { __proto__: null, code: d.code });
    this.name = 'SQLiteError';

    // SQLite error fields.
    this.errcode = d.errcode;      // Extended error code.
    this.errstr = d.errstr;        // Error string from sqlite3_errstr().

    ErrorCaptureStackTrace(this, SQLiteError);
  }
}

ObjectSetPrototypeOf(SQLiteError.prototype, SQLError.prototype);
ObjectSetPrototypeOf(SQLiteError, SQLError);

ObjectDefineProperty(SQLiteError.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'SQLiteError',
});

// Common PostgreSQL error codes.
const PG_ERROR_CODES = {
  __proto__: null,
  // Class 00 - Successful Completion
  SUCCESSFUL_COMPLETION: '00000',

  // Class 23 - Integrity Constraint Violation
  INTEGRITY_CONSTRAINT_VIOLATION: '23000',
  RESTRICT_VIOLATION: '23001',
  NOT_NULL_VIOLATION: '23502',
  FOREIGN_KEY_VIOLATION: '23503',
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',

  // Class 42 - Syntax Error or Access Rule Violation
  SYNTAX_ERROR: '42601',
  UNDEFINED_TABLE: '42P01',
  UNDEFINED_COLUMN: '42703',
  DUPLICATE_TABLE: '42P07',
  DUPLICATE_COLUMN: '42701',

  // Class 53 - Insufficient Resources
  INSUFFICIENT_RESOURCES: '53000',
  DISK_FULL: '53100',
  OUT_OF_MEMORY: '53200',
  TOO_MANY_CONNECTIONS: '53300',

  // Class 57 - Operator Intervention
  OPERATOR_INTERVENTION: '57000',
  QUERY_CANCELED: '57014',
  ADMIN_SHUTDOWN: '57P01',
  CRASH_SHUTDOWN: '57P02',

  // Class 08 - Connection Exception
  CONNECTION_EXCEPTION: '08000',
  CONNECTION_DOES_NOT_EXIST: '08003',
  CONNECTION_FAILURE: '08006',
};

// Common SQLite error codes.
const SQLITE_ERROR_CODES = {
  __proto__: null,
  SQLITE_OK: 0,
  SQLITE_ERROR: 1,
  SQLITE_INTERNAL: 2,
  SQLITE_PERM: 3,
  SQLITE_ABORT: 4,
  SQLITE_BUSY: 5,
  SQLITE_LOCKED: 6,
  SQLITE_NOMEM: 7,
  SQLITE_READONLY: 8,
  SQLITE_INTERRUPT: 9,
  SQLITE_IOERR: 10,
  SQLITE_CORRUPT: 11,
  SQLITE_NOTFOUND: 12,
  SQLITE_FULL: 13,
  SQLITE_CANTOPEN: 14,
  SQLITE_PROTOCOL: 15,
  SQLITE_EMPTY: 16,
  SQLITE_SCHEMA: 17,
  SQLITE_TOOBIG: 18,
  SQLITE_CONSTRAINT: 19,
  SQLITE_MISMATCH: 20,
  SQLITE_MISUSE: 21,
  SQLITE_NOLFS: 22,
  SQLITE_AUTH: 23,
  SQLITE_FORMAT: 24,
  SQLITE_RANGE: 25,
  SQLITE_NOTADB: 26,
  SQLITE_NOTICE: 27,
  SQLITE_WARNING: 28,
  SQLITE_ROW: 100,
  SQLITE_DONE: 101,

  // Extended constraint error codes (for distinguishing constraint types)
  SQLITE_CONSTRAINT_CHECK: 275,        // SQLITE_CONSTRAINT | (1<<8)
  SQLITE_CONSTRAINT_FOREIGNKEY: 787,   // SQLITE_CONSTRAINT | (3<<8)
  SQLITE_CONSTRAINT_NOTNULL: 1299,     // SQLITE_CONSTRAINT | (5<<8)
  SQLITE_CONSTRAINT_PRIMARYKEY: 1555,  // SQLITE_CONSTRAINT | (6<<8)
  SQLITE_CONSTRAINT_UNIQUE: 2067,      // SQLITE_CONSTRAINT | (8<<8)
};

/**
 * Connection closed error.
 */
class SQLConnectionClosedError extends SQLError {
  constructor() {
    super('Cannot perform operation: SQL connection is closed', {
      __proto__: null,
      code: 'ERR_SQL_CONNECTION_CLOSED',
    });
    this.name = 'SQLConnectionClosedError';
    ErrorCaptureStackTrace(this, SQLConnectionClosedError);
  }
}

ObjectSetPrototypeOf(SQLConnectionClosedError.prototype, SQLError.prototype);
ObjectSetPrototypeOf(SQLConnectionClosedError, SQLError);

/**
 * Transaction already committed error.
 */
class SQLTransactionCommittedError extends SQLError {
  constructor() {
    super('Cannot perform operation: transaction has already been committed', {
      __proto__: null,
      code: 'ERR_SQL_TRANSACTION_ALREADY_COMMITTED',
    });
    this.name = 'SQLTransactionCommittedError';
    ErrorCaptureStackTrace(this, SQLTransactionCommittedError);
  }
}

ObjectSetPrototypeOf(SQLTransactionCommittedError.prototype, SQLError.prototype);
ObjectSetPrototypeOf(SQLTransactionCommittedError, SQLError);

/**
 * Transaction already rolled back error.
 */
class SQLTransactionRolledBackError extends SQLError {
  constructor() {
    super('Cannot perform operation: transaction has already been rolled back', {
      __proto__: null,
      code: 'ERR_SQL_TRANSACTION_ALREADY_ROLLED_BACK',
    });
    this.name = 'SQLTransactionRolledBackError';
    ErrorCaptureStackTrace(this, SQLTransactionRolledBackError);
  }
}

ObjectSetPrototypeOf(SQLTransactionRolledBackError.prototype, SQLError.prototype);
ObjectSetPrototypeOf(SQLTransactionRolledBackError, SQLError);

/**
 * Transaction not started error.
 */
class SQLTransactionNotStartedError extends SQLError {
  constructor() {
    super('Cannot perform operation: transaction has not been started', {
      __proto__: null,
      code: 'ERR_SQL_TRANSACTION_NOT_STARTED',
    });
    this.name = 'SQLTransactionNotStartedError';
    ErrorCaptureStackTrace(this, SQLTransactionNotStartedError);
  }
}

ObjectSetPrototypeOf(SQLTransactionNotStartedError.prototype, SQLError.prototype);
ObjectSetPrototypeOf(SQLTransactionNotStartedError, SQLError);

// ============================================================================
// Error Type Guards (for easier error handling)
// ============================================================================

/**
 * Check if an error is a unique constraint violation.
 * Works for both PostgreSQL (23505) and SQLite (CONSTRAINT_UNIQUE).
 * @param {Error} err - Error to check.
 * @returns {boolean} True if unique violation.
 */
function isUniqueViolation(err) {
  if (err instanceof PostgresError) {
    return err.code === PG_ERROR_CODES.UNIQUE_VIOLATION;
  }
  if (err instanceof SQLiteError) {
    // Check extended error code, fall back to primary key as well
    return err.errcode === SQLITE_ERROR_CODES.SQLITE_CONSTRAINT_UNIQUE ||
           err.errcode === SQLITE_ERROR_CODES.SQLITE_CONSTRAINT_PRIMARYKEY;
  }
  return false;
}

/**
 * Check if an error is a foreign key violation.
 * Works for both PostgreSQL (23503) and SQLite (CONSTRAINT_FOREIGNKEY).
 * @param {Error} err - Error to check.
 * @returns {boolean} True if foreign key violation.
 */
function isForeignKeyViolation(err) {
  if (err instanceof PostgresError) {
    return err.code === PG_ERROR_CODES.FOREIGN_KEY_VIOLATION;
  }
  if (err instanceof SQLiteError) {
    return err.errcode === SQLITE_ERROR_CODES.SQLITE_CONSTRAINT_FOREIGNKEY;
  }
  return false;
}

/**
 * Check if an error is a not null violation.
 * @param {Error} err - Error to check.
 * @returns {boolean} True if not null violation.
 */
function isNotNullViolation(err) {
  if (err instanceof PostgresError) {
    return err.code === PG_ERROR_CODES.NOT_NULL_VIOLATION;
  }
  if (err instanceof SQLiteError) {
    return err.errcode === SQLITE_ERROR_CODES.SQLITE_CONSTRAINT_NOTNULL;
  }
  return false;
}

/**
 * Check if an error is a check constraint violation.
 * @param {Error} err - Error to check.
 * @returns {boolean} True if check constraint violation.
 */
function isCheckViolation(err) {
  if (err instanceof PostgresError) {
    return err.code === PG_ERROR_CODES.CHECK_VIOLATION;
  }
  if (err instanceof SQLiteError) {
    return err.errcode === SQLITE_ERROR_CODES.SQLITE_CONSTRAINT_CHECK;
  }
  return false;
}

/**
 * Check if an error is a connection error.
 * @param {Error} err - Error to check.
 * @returns {boolean} True if connection error.
 */
function isConnectionError(err) {
  if (err instanceof SQLConnectionClosedError) {
    return true;
  }
  if (err instanceof PostgresError) {
    const code = err.code;
    return code === PG_ERROR_CODES.CONNECTION_EXCEPTION ||
           code === PG_ERROR_CODES.CONNECTION_DOES_NOT_EXIST ||
           code === PG_ERROR_CODES.CONNECTION_FAILURE;
  }
  return false;
}

/**
 * Check if an error is a syntax error.
 * @param {Error} err - Error to check.
 * @returns {boolean} True if syntax error.
 */
function isSyntaxError(err) {
  if (err instanceof PostgresError) {
    return err.code === PG_ERROR_CODES.SYNTAX_ERROR;
  }
  if (err instanceof SQLiteError) {
    // SQLite uses generic SQLITE_ERROR for syntax errors, so inspect message.
    return err.errcode === SQLITE_ERROR_CODES.SQLITE_ERROR &&
           RegExpPrototypeTest(SQLITE_SYNTAX_ERROR_REGEX, err.message);
  }
  return false;
}

/**
 * Check if an error indicates the table doesn't exist.
 * @param {Error} err - Error to check.
 * @returns {boolean} True if undefined table error.
 */
function isUndefinedTable(err) {
  if (err instanceof PostgresError) {
    return err.code === PG_ERROR_CODES.UNDEFINED_TABLE;
  }
  if (err instanceof SQLiteError) {
    // SQLite uses generic SQLITE_ERROR for undefined table, so inspect message.
    return err.errcode === SQLITE_ERROR_CODES.SQLITE_ERROR &&
           RegExpPrototypeTest(SQLITE_NO_SUCH_TABLE_REGEX, err.message);
  }
  return false;
}

module.exports = {
  __proto__: null,
  SQLError,
  PostgresError,
  SQLiteError,
  SQLConnectionClosedError,
  SQLTransactionCommittedError,
  SQLTransactionRolledBackError,
  SQLTransactionNotStartedError,
  PG_ERROR_CODES,
  SQLITE_ERROR_CODES,
  // Error type guards
  isUniqueViolation,
  isForeignKeyViolation,
  isNotNullViolation,
  isCheckViolation,
  isConnectionError,
  isSyntaxError,
  isUndefinedTable,
};

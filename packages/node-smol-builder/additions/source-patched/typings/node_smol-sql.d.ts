/**
 * node:smol-sql - High-Performance Unified SQL API
 *
 * A Bun-compatible SQL interface for PostgreSQL and SQLite with tagged template
 * literals. Automatically parameterized queries prevent SQL injection.
 *
 * Performance features:
 * - **Connection pooling**: Efficient connection reuse for PostgreSQL
 * - **Prepared statements**: Automatic query plan caching
 * - **Streaming cursors**: Memory-efficient large result sets
 * - **Batch operations**: insertMany, upsertMany, deleteMany, updateMany
 * - **Tagged templates**: Zero-overhead parameterization
 *
 * @example
 * ```ts
 * import { sql } from 'node:smol-sql';
 *
 * // Auto-parameterized queries
 * const users = await sql`SELECT * FROM users WHERE id = ${userId}`;
 *
 * // Batch insert (single transaction)
 * await sql.insertMany('users', [
 *   { name: 'Alice', age: 30 },
 *   { name: 'Bob', age: 25 },
 * ]);
 *
 * // Streaming for large results
 * for await (const row of sql`SELECT * FROM logs`.stream()) {
 *   process(row);
 * }
 * ```
 *
 * @module
 */
declare module 'node:smol-sql' {
  /** Base error class for SQL operations */
  export class SQLError extends Error {
    code?: string;
    constructor(message: string);
  }

  /** PostgreSQL-specific error */
  export class PostgresError extends SQLError {
    severity?: string;
    detail?: string;
    hint?: string;
    position?: string;
    internalPosition?: string;
    internalQuery?: string;
    where?: string;
    schema?: string;
    table?: string;
    column?: string;
    dataType?: string;
    constraint?: string;
    file?: string;
    line?: string;
    routine?: string;
  }

  /** SQLite-specific error */
  export class SQLiteError extends SQLError {
    errcode?: number;
    errstr?: string;
  }

  /** Connection closed error */
  export class SQLConnectionClosedError extends SQLError {
    constructor();
  }

  /** Transaction already committed error */
  export class SQLTransactionCommittedError extends SQLError {
    constructor();
  }

  /** Transaction already rolled back error */
  export class SQLTransactionRolledBackError extends SQLError {
    constructor();
  }

  /** PostgreSQL error codes */
  export const PG_ERROR_CODES: Readonly<{
    SUCCESSFUL_COMPLETION: '00000';
    INTEGRITY_CONSTRAINT_VIOLATION: '23000';
    RESTRICT_VIOLATION: '23001';
    NOT_NULL_VIOLATION: '23502';
    FOREIGN_KEY_VIOLATION: '23503';
    UNIQUE_VIOLATION: '23505';
    CHECK_VIOLATION: '23514';
    EXCLUSION_VIOLATION: '23P01';
    SYNTAX_ERROR: '42601';
    UNDEFINED_TABLE: '42P01';
    UNDEFINED_COLUMN: '42703';
    DUPLICATE_TABLE: '42P07';
    DUPLICATE_COLUMN: '42701';
    INSUFFICIENT_RESOURCES: '53000';
    DISK_FULL: '53100';
    OUT_OF_MEMORY: '53200';
    TOO_MANY_CONNECTIONS: '53300';
    OPERATOR_INTERVENTION: '57000';
    QUERY_CANCELED: '57014';
    ADMIN_SHUTDOWN: '57P01';
    CRASH_SHUTDOWN: '57P02';
    CONNECTION_EXCEPTION: '08000';
    CONNECTION_DOES_NOT_EXIST: '08003';
    CONNECTION_FAILURE: '08006';
  }>;

  /** SQLite error codes */
  export const SQLITE_ERROR_CODES: Readonly<{
    SQLITE_OK: 0;
    SQLITE_ERROR: 1;
    SQLITE_INTERNAL: 2;
    SQLITE_PERM: 3;
    SQLITE_ABORT: 4;
    SQLITE_BUSY: 5;
    SQLITE_LOCKED: 6;
    SQLITE_NOMEM: 7;
    SQLITE_READONLY: 8;
    SQLITE_INTERRUPT: 9;
    SQLITE_IOERR: 10;
    SQLITE_CORRUPT: 11;
    SQLITE_NOTFOUND: 12;
    SQLITE_FULL: 13;
    SQLITE_CANTOPEN: 14;
    SQLITE_PROTOCOL: 15;
    SQLITE_EMPTY: 16;
    SQLITE_SCHEMA: 17;
    SQLITE_TOOBIG: 18;
    SQLITE_CONSTRAINT: 19;
    SQLITE_MISMATCH: 20;
    SQLITE_MISUSE: 21;
    SQLITE_NOLFS: 22;
    SQLITE_AUTH: 23;
    SQLITE_FORMAT: 24;
    SQLITE_RANGE: 25;
    SQLITE_NOTADB: 26;
    SQLITE_NOTICE: 27;
    SQLITE_WARNING: 28;
    SQLITE_ROW: 100;
    SQLITE_DONE: 101;
  }>;

  /** SQL fragment for safe identifier/value escaping */
  export class SQLFragment {
    readonly text: string;
    readonly values: any[];
    constructor(text: string, values?: any[]);
    toString(): string;
  }

  /**
   * SQL Query - represents a pending SQL query.
   * Promise-like with additional result format methods.
   */
  export class SQLQuery<T = Record<string, unknown>> implements PromiseLike<T[]> {
    /** Execute the query and return rows as objects */
    then<TResult1 = T[], TResult2 = never>(
      onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2>;

    /** Execute and return rows as value arrays */
    values(): Promise<any[][]>;

    /** Execute and return rows as raw Buffer arrays */
    raw(): Promise<Buffer[][]>;

    /** Stream rows one at a time */
    stream(): AsyncIterable<T>;

    /** Batch cursor for large result sets */
    cursor(batchSize?: number): AsyncIterable<T[]>;

    /** Start query execution (returns self for chaining) */
    execute(): this;

    /** Cancel a running query */
    cancel(): void;

    /** Execute and return the first row only, or undefined if no rows */
    first(): Promise<T | undefined>;

    /** Execute and return whether any rows exist */
    exists(): Promise<boolean>;

    /** Execute a COUNT query and return the count as a number */
    count(): Promise<number>;

    /** Execute and return the last row only, or undefined if no rows */
    last(): Promise<T | undefined>;

    /** Execute and return the first n rows */
    take(n: number): Promise<T[]>;

    /** Get query introspection info (without executing) */
    getQuery(): { text: string; values: any[]; paramCount: number };
  }

  /**
   * Transaction isolation levels.
   * Use these constants to avoid typos in transaction options.
   * @example
   * await db.begin({ isolationLevel: IsolationLevel.SERIALIZABLE }, async (tx) => {
   *   // transaction code
   * });
   */
  export const IsolationLevel: Readonly<{
    READ_UNCOMMITTED: 'read uncommitted';
    READ_COMMITTED: 'read committed';
    REPEATABLE_READ: 'repeatable read';
    SERIALIZABLE: 'serializable';
  }>;

  /** Transaction options */
  export interface TransactionOptions {
    isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
  }

  /** Savepoint for partial transaction rollback */
  export class Savepoint {
    /** Create the savepoint (called internally) */
    create(): Promise<void>;
    /** Release the savepoint (make changes permanent within transaction) */
    release(): Promise<void>;
    /** Rollback to savepoint (undo changes since savepoint) */
    rollback(): Promise<void>;
  }

  /** Transaction context for atomic operations */
  export class Transaction {
    /** Begin the transaction */
    begin(): Promise<void>;
    /** Commit the transaction */
    commit(): Promise<void>;
    /** Rollback the transaction */
    rollback(): Promise<void>;
    /** Create a named savepoint for partial rollback */
    savepoint<T>(name: string, fn: (sp: Savepoint) => Promise<T>): Promise<T>;
    /** Create an anonymous savepoint for partial rollback */
    savepoint<T>(fn: (sp: Savepoint) => Promise<T>): Promise<T>;
  }

  /** Reserved connection from pool */
  export class ReservedConnection {
    /** Release the connection back to the pool */
    release(): void;
  }

  /** SQL connection options */
  export interface SQLOptions {
    /** Connection URL */
    url?: string;
    /** Database adapter type */
    adapter?: 'postgres' | 'sqlite';
    /** SQLite filename (alternative to URL) */
    filename?: string;
  }

  /** Insert many options */
  export interface InsertManyOptions {
    /** Explicit column list (default: keys from first row) */
    columns?: string[];
    /** Return inserted rows (PostgreSQL only) */
    returning?: boolean;
  }

  /** Upsert options */
  export interface UpsertOptions {
    /** Columns to detect conflict on (required) */
    conflictColumns: string[];
    /** Columns to update on conflict (default: all except conflict columns) */
    updateColumns?: string[];
    /** Return the row (PostgreSQL only) */
    returning?: boolean;
  }

  /**
   * SQL - Main SQL client class.
   * Use as a tagged template or access methods directly.
   *
   * @example
   * const db = new SQL('postgres://user:pass@localhost:5432/mydb');
   * const users = await db`SELECT * FROM users WHERE id = ${1}`;
   *
   * @example
   * // SQLite in-memory
   * const lite = new SQL(':memory:');
   */
  export class SQL {
    constructor(urlOrOptions?: string | SQLOptions, options?: SQLOptions);

    /**
     * Begin a transaction.
     * @example
     * await sql.begin(async (tx) => {
     *   await tx`INSERT INTO users (name) VALUES (${'Alice'})`;
     *   await tx`UPDATE accounts SET balance = balance - 100`;
     * });
     */
    begin<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
    begin<T>(options: TransactionOptions, fn: (tx: Transaction) => Promise<T>): Promise<T>;

    /**
     * Reserve an exclusive connection from the pool.
     * @example
     * const conn = await sql.reserve();
     * try {
     *   await conn`LISTEN my_channel`;
     * } finally {
     *   conn.release();
     * }
     */
    reserve(): Promise<ReservedConnection>;

    /**
     * Close all connections.
     */
    close(options?: { timeout?: number }): Promise<void>;

    /**
     * Execute raw SQL without parameterization.
     * WARNING: Only use with trusted input!
     */
    unsafe(query: string, params?: any[]): SQLQuery;

    /**
     * Execute SQL from a file.
     */
    file(path: string, params?: any[]): SQLQuery;

    /**
     * Find a row by its primary key (convenience method).
     * @example
     * const user = await sql.findById('users', 123);
     * const post = await sql.findById('posts', 'abc-uuid', 'uuid');
     */
    findById<T = Record<string, unknown>>(table: string, id: any, idColumn?: string): Promise<T | undefined>;

    /**
     * Insert multiple rows in a single transaction (convenience method).
     * @example
     * await sql.insertMany('users', [
     *   { name: 'Alice', age: 30 },
     *   { name: 'Bob', age: 25 },
     * ]);
     */
    insertMany<T = Record<string, unknown>>(table: string, rows: Record<string, any>[], options?: InsertManyOptions): Promise<T[]>;

    /**
     * Insert or update a row based on conflict columns (upsert).
     * @example
     * await sql.upsert('users', { id: 1, name: 'Alice' }, { conflictColumns: ['id'] });
     */
    upsert<T = Record<string, unknown>>(table: string, row: Record<string, any>, options: UpsertOptions): Promise<T | undefined>;

    /**
     * Insert or update multiple rows based on conflict columns (batch upsert).
     * @example
     * await sql.upsertMany('users', [
     *   { id: 1, name: 'Alice' },
     *   { id: 2, name: 'Bob' },
     * ], { conflictColumns: ['id'] });
     */
    upsertMany<T = Record<string, unknown>>(table: string, rows: Record<string, any>[], options: UpsertOptions): Promise<T[]>;

    /**
     * Delete multiple rows by their IDs (batch delete).
     * @example
     * const count = await sql.deleteMany('users', [1, 2, 3]);
     * const count = await sql.deleteMany('users', ['a-uuid', 'b-uuid'], 'uuid');
     * @returns Number of rows deleted
     */
    deleteMany(table: string, ids: any[], idColumn?: string): Promise<number>;

    /**
     * Update multiple rows by their IDs (batch update).
     * @example
     * const count = await sql.updateMany('users', [1, 2, 3], { active: false });
     * const count = await sql.updateMany('users', ['a-uuid', 'b-uuid'], { active: false }, 'uuid');
     * @returns Number of rows updated
     */
    updateMany(table: string, ids: any[], values: Record<string, any>, idColumn?: string): Promise<number>;

    /** Create an identifier fragment (table/column name) */
    static identifier(name: string | string[]): SQLFragment;

    /** Create an array literal (PostgreSQL) */
    static array(values: any[]): SQLFragment;

    /** Create a JSON value */
    static json(value: any): SQLFragment;
  }

  /**
   * Default SQL instance using environment variables.
   * Uses POSTGRES_URL or DATABASE_URL.
   *
   * @example
   * import { sql } from 'node:smol-sql';
   * const users = await sql`SELECT * FROM users WHERE active = ${true}`;
   */
  export const sql: SQL & {
    /** Create an identifier fragment */
    identifier(name: string | string[]): SQLFragment;
    /** Create an array literal (PostgreSQL) */
    array(values: any[]): SQLFragment;
    /** Create a JSON value */
    json(value: any): SQLFragment;
  };

  // ============================================================================
  // Error Type Guards
  // ============================================================================

  /**
   * Check if an error is a unique constraint violation.
   * Works for both PostgreSQL (23505) and SQLite (CONSTRAINT).
   */
  export function isUniqueViolation(err: Error): boolean;

  /**
   * Check if an error is a foreign key violation.
   * Works for both PostgreSQL (23503) and SQLite (CONSTRAINT).
   */
  export function isForeignKeyViolation(err: Error): boolean;

  /**
   * Check if an error is a not null violation.
   */
  export function isNotNullViolation(err: Error): boolean;

  /**
   * Check if an error is a check constraint violation.
   */
  export function isCheckViolation(err: Error): boolean;

  /**
   * Check if an error is a connection error.
   */
  export function isConnectionError(err: Error): boolean;

  /**
   * Check if an error is a syntax error.
   */
  export function isSyntaxError(err: Error): boolean;

  /**
   * Check if an error indicates the table doesn't exist.
   */
  export function isUndefinedTable(err: Error): boolean;

  export default sql;
}

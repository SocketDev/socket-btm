# node:sql - Unified SQL API

A high-performance, Bun-compatible SQL API for Node.js with PostgreSQL and SQLite support.

## Overview

The `node:sql` module provides a unified, Promise-based interface for SQL databases using tagged
template literals. It's designed for performance, security, and ease of use.

### Supported Databases

| Database   | Adapter          | Backend                   |
|------------|------------------|---------------------------|
| PostgreSQL | Native C++       | libpq (bundled)           |
| SQLite     | Native C++       | node:sqlite (built-in)    |

## Quick Start

```javascript
import { sql, SQL } from 'node:sql';

// Default PostgreSQL (uses POSTGRES_URL env var)
const users = await sql`SELECT * FROM users WHERE id = ${1}`;

// Explicit connection
const db = new SQL('postgres://user:pass@localhost:5432/mydb');
const rows = await db`SELECT * FROM posts WHERE author_id = ${userId}`;

// SQLite
const lite = new SQL(':memory:');
await lite`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)`;
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        node:sql (lib/sql.js)                    │
│                     Public API Entry Point                      │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                 lib/internal/sql/index.js                       │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   SQL       │  │   Query     │  │   Result                │  │
│  │   Class     │  │   Builder   │  │   Parser                │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                                                                 │
│  Tagged Template Parser  │  Connection Pool Manager             │
│  Transaction Coordinator │  Prepared Statement Cache            │
└─────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│  lib/internal/sql/          │   │  lib/internal/sql/          │
│       postgres.js           │   │       sqlite.js             │
│                             │   │                             │
│  PostgreSQL Adapter         │   │  SQLite Adapter             │
│  - Connection management    │   │  - Wraps node:sqlite        │
│  - Binary protocol          │   │  - In-memory support        │
│  - Async queries            │   │  - File databases           │
└─────────────────────────────┘   └─────────────────────────────┘
              │                               │
              ▼                               ▼
┌──────────────────────────────┐   ┌─────────────────────────────┐
│  internalBinding('smol_postgres')│   │  internalBinding('sqlite')  │
│                             │   │                             │
│  postgres_binding.cc        │   │  node_sqlite.cc             │
│  postgres_pool.cc           │   │  (Node.js built-in)         │
│  libpq (bundled)            │   │  sqlite3 (bundled)          │
└─────────────────────────────┘   └─────────────────────────────┘
```

## Performance Optimizations

### 1. Tagged Template Identity Caching

Tagged template functions receive the same `strings` array reference for identical template
literals. We exploit this for O(1) query lookup:

```javascript
// These two calls share the same strings array identity
await sql`SELECT * FROM users WHERE id = ${1}`;
await sql`SELECT * FROM users WHERE id = ${2}`;

// Internal cache: WeakMap<strings, PreparedQuery>
// First call: parse template, prepare statement
// Second call: direct cache hit, reuse prepared statement
```

### 2. Automatic Prepared Statements

Queries are automatically converted to prepared statements with parameter placeholders:

```javascript
// User writes:
await sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;

// Becomes (PostgreSQL):
// PREPARE stmt_abc AS SELECT * FROM users WHERE name = $1 AND age > $2
// EXECUTE stmt_abc('John', 25)
```

### 3. Connection Pooling

PostgreSQL connections are pooled with configurable limits:

```javascript
const db = new SQL('postgres://localhost/mydb', {
  max: 20,              // Maximum connections
  idleTimeout: 30000,   // Close idle connections after 30s
  maxLifetime: 3600000, // Max connection age: 1 hour
});
```

### 4. Binary Protocol (PostgreSQL)

Uses PostgreSQL's binary wire protocol for efficient data transfer:
- No string parsing for integers, floats, timestamps
- Direct memory transfer for binary data
- Reduced CPU overhead

### 5. Result Streaming

Large result sets can be streamed to avoid memory pressure:

```javascript
for await (const row of db`SELECT * FROM large_table`.stream()) {
  processRow(row);
}
```

## API Reference

### SQL Class

```typescript
class SQL {
  constructor(url: string | SQLOptions);

  // Tagged template query - returns Promise<Row[]>
  (strings: TemplateStringsArray, ...values: any[]): SQLQuery;

  // Transaction management
  begin<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  begin<T>(options: TransactionOptions, fn: (tx: Transaction) => Promise<T>): Promise<T>;

  // Connection management
  reserve(): Promise<ReservedConnection>;
  close(options?: CloseOptions): Promise<void>;

  // Utilities
  unsafe(query: string, params?: any[]): SQLQuery;
  file(path: string, params?: any[]): SQLQuery;

  // Static helpers
  static array(values: any[]): SQLFragment;
  static json(value: any): SQLFragment;
}
```

### SQLOptions

```typescript
interface SQLOptions {
  // Connection
  url?: string;
  hostname?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string | (() => string | Promise<string>);

  // TLS (PostgreSQL)
  tls?: boolean | TLSOptions;
  ssl?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

  // Pool settings
  max?: number;              // Default: 10
  idleTimeout?: number;      // Default: 30000 (30s)
  maxLifetime?: number;      // Default: 3600000 (1h)
  connectionTimeout?: number; // Default: 10000 (10s)

  // Type handling
  bigint?: boolean;          // Return BigInt for large integers

  // Callbacks
  onconnect?: (client: Connection) => void;
  onclose?: (client: Connection, error?: Error) => void;
}
```

### SQLQuery

Returned by tagged template calls. Extends Promise for await:

```typescript
interface SQLQuery extends Promise<Row[]> {
  // Result format modifiers
  values(): Promise<any[][]>;     // Arrays instead of objects
  raw(): Promise<Buffer[][]>;     // Raw binary buffers

  // Streaming
  stream(): AsyncIterable<Row>;

  // Control
  execute(): SQLQuery;            // Start execution
  cancel(): void;                 // Cancel running query

  // Cursor (PostgreSQL)
  cursor(batchSize?: number): AsyncIterable<Row[]>;
}
```

### Transaction

```typescript
interface Transaction {
  // Query execution (same as SQL class)
  (strings: TemplateStringsArray, ...values: any[]): SQLQuery;

  // Savepoints
  savepoint<T>(fn: (sp: Savepoint) => Promise<T>): Promise<T>;
  savepoint<T>(name: string, fn: (sp: Savepoint) => Promise<T>): Promise<T>;
}

interface TransactionOptions {
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
  readOnly?: boolean;
  deferrable?: boolean;  // PostgreSQL only
}
```

### SQL Fragment Helpers

```typescript
// Dynamic identifiers (table/column names)
sql`SELECT * FROM ${sql('users')}`;  // SELECT * FROM "users"

// Multiple columns/tables
sql`SELECT ${sql(['id', 'name'])} FROM users`;  // SELECT "id", "name" FROM users

// Array values for IN clauses
sql`SELECT * FROM users WHERE id IN ${sql([1, 2, 3])}`;  // ... IN ($1, $2, $3)

// Object insert with column selection
sql`INSERT INTO users ${sql(user, 'name', 'email')}`;
// INSERT INTO users ("name", "email") VALUES ($1, $2)

// Bulk insert
sql`INSERT INTO users ${sql([user1, user2, user3])}`;
// INSERT INTO users ("id", "name") VALUES ($1, $2), ($3, $4), ($5, $6)

// PostgreSQL array literals
sql`UPDATE users SET tags = ${SQL.array(['a', 'b'])} WHERE id = ${1}`;
// UPDATE users SET tags = ARRAY['a', 'b'] WHERE id = $1

// JSON
sql`INSERT INTO data (json_col) VALUES (${SQL.json({ foo: 'bar' })})`;
```

## Environment Variables

### PostgreSQL

| Variable       | Description                    |
|----------------|--------------------------------|
| `POSTGRES_URL` | Primary connection URL         |
| `PGHOST`       | Database host                  |
| `PGPORT`       | Database port (default: 5432)  |
| `PGUSER`       | Username                       |
| `PGPASSWORD`   | Password                       |
| `PGDATABASE`   | Database name                  |

### SQLite

| Variable       | Description                    |
|----------------|--------------------------------|
| `DATABASE_URL` | SQLite file path or `:memory:` |

## Implementation Details

### Primordials Usage

All internal JavaScript code uses primordials to prevent prototype pollution attacks:

```javascript
'use strict';

const {
  ArrayPrototypeJoin,
  ArrayPrototypePush,
  ArrayPrototypeMap,
  FunctionPrototypeBind,
  ObjectDefineProperty,
  ObjectFreeze,
  Promise,
  PromisePrototypeThen,
  PromiseReject,
  PromiseResolve,
  SafeMap,
  SafeWeakMap,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  Symbol,
  SymbolAsyncIterator,
} = primordials;
```

### Query Template Parsing

The tagged template parser converts user queries to parameterized SQL:

```javascript
// Input
sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`

// Parsed (PostgreSQL)
{
  text: 'SELECT * FROM users WHERE name = $1 AND age > $2',
  values: [name, age],
  hash: 'a1b2c3d4',  // For prepared statement naming
}

// Parsed (SQLite)
{
  text: 'SELECT * FROM users WHERE name = ? AND age > ?',
  values: [name, age],
}
```

### C++ Binding Interface

```cpp
// PostgreSQL async bindings
namespace postgres {

class PostgresBinding {
 public:
  // Pool management
  static void CreatePool(const FunctionCallbackInfo<Value>& args);
  static void DestroyPool(const FunctionCallbackInfo<Value>& args);

  // Async query execution
  static void QueryAsync(const FunctionCallbackInfo<Value>& args);
  static void QueryParamsAsync(const FunctionCallbackInfo<Value>& args);

  // Prepared statements
  static void PrepareAsync(const FunctionCallbackInfo<Value>& args);
  static void ExecutePreparedAsync(const FunctionCallbackInfo<Value>& args);

  // Transaction support
  static void BeginTransaction(const FunctionCallbackInfo<Value>& args);
  static void CommitTransaction(const FunctionCallbackInfo<Value>& args);
  static void RollbackTransaction(const FunctionCallbackInfo<Value>& args);

  // Query cancellation
  static void CancelQuery(const FunctionCallbackInfo<Value>& args);

  // Result streaming
  static void CreateCursor(const FunctionCallbackInfo<Value>& args);
  static void FetchCursor(const FunctionCallbackInfo<Value>& args);
  static void CloseCursor(const FunctionCallbackInfo<Value>& args);
};

}  // namespace postgres
```

### Type Mapping

| PostgreSQL Type | JavaScript Type | Notes                              |
|-----------------|-----------------|-------------------------------------|
| INTEGER         | number          | Safe integers                       |
| BIGINT          | string/BigInt   | Depends on `bigint` option          |
| REAL/FLOAT      | number          |                                     |
| NUMERIC/DECIMAL | string          | Precision preservation              |
| TEXT/VARCHAR    | string          |                                     |
| BOOLEAN         | boolean         |                                     |
| BYTEA           | Uint8Array      |                                     |
| JSON/JSONB      | object/array    | Auto-parsed                         |
| TIMESTAMP       | Date            |                                     |
| DATE            | Date            |                                     |
| ARRAY           | Array           |                                     |
| NULL            | null            |                                     |

| SQLite Type | JavaScript Type | Notes                              |
|-------------|-----------------|-------------------------------------|
| INTEGER     | number/BigInt   | Depends on `bigint` option          |
| REAL        | number          |                                     |
| TEXT        | string          |                                     |
| BLOB        | Uint8Array      |                                     |
| NULL        | null            |                                     |

## Error Handling

```javascript
import { SQL, PostgresError, SQLiteError } from 'node:sql';

try {
  await sql`INSERT INTO users (id) VALUES (${1})`;
} catch (error) {
  if (error instanceof PostgresError) {
    console.log(error.code);      // '23505' (unique violation)
    console.log(error.detail);    // 'Key (id)=(1) already exists.'
    console.log(error.table);     // 'users'
    console.log(error.constraint);// 'users_pkey'
  } else if (error instanceof SQLiteError) {
    console.log(error.code);      // 'SQLITE_CONSTRAINT'
  }
}
```

## File Structure

```
lib/
├── sql.js                          # Public entry point (node:sql)
└── internal/
    └── sql/
        ├── index.js                # Core SQL class and utilities
        ├── query.js                # Query parsing and template handling
        ├── result.js               # Result set handling
        ├── transaction.js          # Transaction coordinator
        ├── adapters/
        │   ├── postgres.js         # PostgreSQL adapter
        │   └── sqlite.js           # SQLite adapter
        └── errors.js               # Error classes

src/socketsecurity/postgres/
├── postgres_binding.cc             # V8 bindings
├── postgres_binding.h
├── postgres_pool.cc                # Connection pooling
├── postgres_pool.h
├── postgres_async.cc               # Async query execution
├── postgres_cursor.cc              # Cursor/streaming support
└── postgres_types.cc               # Type conversion
```

## Build Configuration

Enable PostgreSQL support (on by default in node-smol):

```bash
# Configure with PostgreSQL
./configure --with-postgres

# GYP variables
node_use_postgres=true   # Enable PostgreSQL
node_use_sqlite=true     # Enable SQLite (default)
```

## Comparison with Bun.SQL

| Feature                | node:sql | Bun.SQL |
|------------------------|----------|---------|
| PostgreSQL             | Yes      | Yes     |
| SQLite                 | Yes      | Yes     |
| MySQL                  | No       | Yes     |
| Tagged templates       | Yes      | Yes     |
| Auto-prepared stmts    | Yes      | Yes     |
| Connection pooling     | Yes      | Yes     |
| Transactions           | Yes      | Yes     |
| Savepoints             | Yes      | Yes     |
| Cursors/streaming      | Yes      | Yes     |
| BigInt support         | Yes      | Yes     |
| Binary protocol        | Yes      | Yes     |
| Query cancellation     | Yes      | Yes     |
| Dynamic passwords      | Yes      | Yes     |
| `--sql-preconnect`     | No       | Yes     |

## Security Considerations

1. **Parameterized queries**: All interpolated values become parameters, never concatenated
2. **Identifier escaping**: Dynamic identifiers are quoted and validated
3. **Primordials**: Internal code immune to prototype pollution
4. **No eval**: Query parsing uses static analysis, no dynamic code execution
5. **Connection validation**: URLs are parsed and validated before connection

# node:smol-sql - Unified SQL API

A high-performance, Bun-compatible SQL interface for PostgreSQL and SQLite with tagged template literals. Write secure SQL queries that are automatically parameterized.

## What is Tagged Template SQL?

Instead of concatenating strings (which is dangerous), you write SQL using JavaScript's tagged template literals. The library automatically handles parameterization, preventing SQL injection.

```javascript
// UNSAFE - string concatenation (DON'T DO THIS!)
const result = await db.query(`SELECT * FROM users WHERE id = ${userId}`);

// SAFE - tagged template (DO THIS!)
const result = await sql`SELECT * FROM users WHERE id = ${userId}`;
```

The `${userId}` value becomes a parameter (`$1` for PostgreSQL, `?` for SQLite) and is safely escaped.

## Quick Start

```javascript
import { sql, SQL } from 'node:smol-sql';

// Using default connection (reads POSTGRES_URL or DATABASE_URL env var)
const users = await sql`SELECT * FROM users WHERE active = ${true}`;
console.log(users);  // Array of user objects

// Using explicit connection
const db = new SQL('postgres://user:pass@localhost:5432/mydb');
const posts = await db`SELECT * FROM posts WHERE author_id = ${userId}`;

// SQLite (in-memory or file)
const lite = new SQL(':memory:');
await lite`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)`;
await lite`INSERT INTO items (name) VALUES (${'Widget'})`;
```

## When to Use

Use `node:smol-sql` when you need to:
- Query PostgreSQL or SQLite databases
- Write secure, parameterized SQL
- Use transactions for data integrity
- Stream large result sets

## API Reference

### Creating Connections

#### Default `sql` Instance
Uses `POSTGRES_URL` or `DATABASE_URL` environment variable.

```javascript
import { sql } from 'node:smol-sql';

const users = await sql`SELECT * FROM users`;
```

#### `new SQL(url, options?)`
Create a new database connection.

```javascript
// PostgreSQL
const pg = new SQL('postgres://user:pass@localhost:5432/mydb');
const pg2 = new SQL('postgresql://user:pass@localhost:5432/mydb');

// SQLite in-memory
const lite = new SQL(':memory:');

// SQLite file
const fileDb = new SQL('sqlite://./data.db');
const fileDb2 = new SQL('file://./data.db');
```

### Running Queries

Queries are written as tagged template literals and return arrays of objects.

#### Basic Queries

```javascript
// Select all rows
const users = await sql`SELECT * FROM users`;
// [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]

// With parameters (automatically escaped)
const userId = 1;
const user = await sql`SELECT * FROM users WHERE id = ${userId}`;
// [{ id: 1, name: 'Alice' }]

// Multiple parameters
const active = true;
const limit = 10;
const results = await sql`
  SELECT * FROM users
  WHERE active = ${active}
  LIMIT ${limit}
`;
```

#### Insert

```javascript
const name = 'Charlie';
const email = 'charlie@example.com';
await sql`INSERT INTO users (name, email) VALUES (${name}, ${email})`;
```

#### Update

```javascript
const newName = 'Charles';
const userId = 3;
await sql`UPDATE users SET name = ${newName} WHERE id = ${userId}`;
```

#### Delete

```javascript
const userId = 3;
await sql`DELETE FROM users WHERE id = ${userId}`;
```

### Result Formats

#### Objects (Default)
Rows returned as objects with column names as keys.

```javascript
const users = await sql`SELECT id, name FROM users`;
// [{ id: 1, name: 'Alice' }]
```

#### `.values()` - Arrays
Rows returned as arrays (faster, smaller).

```javascript
const users = await sql`SELECT id, name FROM users`.values();
// [[1, 'Alice'], [2, 'Bob']]
```

#### `.raw()` - Buffers
Raw data as Buffers (for binary data).

```javascript
const data = await sql`SELECT image FROM files WHERE id = ${1}`.raw();
```

### Transactions

Transactions ensure multiple operations succeed or fail together.

#### Basic Transaction

```javascript
await sql.begin(async (tx) => {
  await tx`INSERT INTO accounts (name) VALUES (${'Savings'})`;
  await tx`UPDATE balances SET amount = amount - ${100} WHERE account = 'checking'`;
  await tx`UPDATE balances SET amount = amount + ${100} WHERE account = 'savings'`;
});
// If any operation fails, all are rolled back
```

#### With Savepoints

Savepoints allow partial rollback within a transaction.

```javascript
await sql.begin(async (tx) => {
  await tx`INSERT INTO users (name) VALUES (${'Alice'})`;

  const sp = await tx.savepoint();
  try {
    await tx`INSERT INTO users (name) VALUES (${'Bob'})`;
    // Something might fail here
  } catch (err) {
    await sp.rollback();  // Only rolls back to savepoint
  }

  await tx`INSERT INTO users (name) VALUES (${'Charlie'})`;
});
```

### Reserved Connections

For operations that need a dedicated connection (like LISTEN/NOTIFY).

```javascript
const conn = await sql.reserve();
try {
  await conn`LISTEN my_channel`;
  // Use the connection...
  await conn`SELECT * FROM users`;
} finally {
  conn.release();  // Always release!
}
```

### Streaming Large Results

For large result sets, stream rows instead of loading all into memory.

#### Async Iterator

```javascript
for await (const row of sql`SELECT * FROM large_table`.stream()) {
  console.log(row);
}
```

#### Cursor (Batched)

```javascript
for await (const batch of sql`SELECT * FROM large_table`.cursor(100)) {
  // batch is an array of up to 100 rows
  console.log(`Processing ${batch.length} rows`);
}
```

### Query Cancellation

Cancel a long-running query.

```javascript
const query = sql`SELECT * FROM huge_table`;
setTimeout(() => query.cancel(), 5000);  // Cancel after 5 seconds

try {
  const result = await query;
} catch (err) {
  if (err.code === 'QUERY_CANCELLED') {
    console.log('Query was cancelled');
  }
}
```

### Static Methods

#### `SQL.identifier(name)`
Safely escape table/column names.

```javascript
const tableName = 'users';
await sql`SELECT * FROM ${sql.identifier(tableName)}`;
```

#### `SQL.array(values)`
Create a PostgreSQL array.

```javascript
const ids = [1, 2, 3];
await sql`SELECT * FROM users WHERE id = ANY(${sql.array(ids)})`;
```

#### `SQL.json(value)`
Create a JSONB value.

```javascript
const data = { name: 'Alice', tags: ['admin'] };
await sql`INSERT INTO users (data) VALUES (${sql.json(data)})`;
```

### Unsafe Queries

For dynamic SQL (use with extreme caution!).

```javascript
// Only use when you fully control the input
const tableName = 'users';  // NEVER from user input!
await sql.unsafe(`SELECT * FROM ${tableName}`);
```

### SQL from Files

Execute SQL from a file.

```javascript
await sql.file('./migrations/001_create_users.sql');
```

### Closing Connections

```javascript
await sql.close();
// or with timeout
await sql.close({ timeout: 5000 });
```

### Error Classes

```javascript
import { SQLError, PostgresError, SQLiteError } from 'node:smol-sql';

try {
  await sql`INSERT INTO users (id) VALUES (${1})`;  // Duplicate key
} catch (err) {
  if (err instanceof PostgresError) {
    console.log('PostgreSQL error:', err.code);  // e.g., '23505' for unique violation
  } else if (err instanceof SQLiteError) {
    console.log('SQLite error:', err.code);
  } else if (err instanceof SQLError) {
    console.log('Generic SQL error');
  }
}
```

### SQLFragment

For building reusable query parts.

```javascript
const whereClause = sql`WHERE active = ${true}`;
const users = await sql`SELECT * FROM users ${whereClause}`;

// Check fragment properties
console.log(whereClause.text);    // 'WHERE active = $1'
console.log(whereClause.values);  // [true]
```

## Common Patterns

### Connection Check

```javascript
try {
  await sql`SELECT 1`;
  console.log('Database connected!');
} catch (err) {
  console.error('Database connection failed:', err.message);
}
```

### Conditional Queries

```javascript
const filters = [];
const values = [];

if (name) {
  filters.push('name = $' + (values.length + 1));
  values.push(name);
}
if (active !== undefined) {
  filters.push('active = $' + (values.length + 1));
  values.push(active);
}

const whereClause = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
const users = await sql.unsafe(`SELECT * FROM users ${whereClause}`, values);
```

### Upsert (Insert or Update)

```javascript
// PostgreSQL
await sql`
  INSERT INTO users (id, name, email)
  VALUES (${id}, ${name}, ${email})
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email
`;

// SQLite
await lite`
  INSERT INTO users (id, name, email)
  VALUES (${id}, ${name}, ${email})
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    email = excluded.email
`;
```

### Batch Insert

```javascript
const users = [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
];

await sql.begin(async (tx) => {
  for (const user of users) {
    await tx`INSERT INTO users (name, email) VALUES (${user.name}, ${user.email})`;
  }
});
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `POSTGRES_URL` | PostgreSQL connection URL (preferred) |
| `DATABASE_URL` | Fallback connection URL |

`POSTGRES_URL` takes precedence if both are set.

## Supported Databases

| Database | URL Prefix | Notes |
|----------|-----------|-------|
| PostgreSQL | `postgres://` or `postgresql://` | Full support |
| SQLite | `:memory:`, `sqlite://`, `file://` | In-memory or file |

## Bun Compatibility

This API is designed to be compatible with Bun's `bun:sql` module. Code written for one should work with the other.

```javascript
// Works with both node:smol-sql and bun:sql
import sql from 'node:smol-sql';
const users = await sql`SELECT * FROM users`;
```

## Performance

### Native C++ PostgreSQL Bindings

The PostgreSQL adapter uses native C++ bindings via `internalBinding('smol_postgres')` instead of pure JavaScript:
- **libpq integration** - Bundled PostgreSQL client library for direct protocol handling
- **Zero-copy result parsing** - Results parsed directly from wire format to V8 values
- **Async I/O** - Integrated with libuv event loop for non-blocking queries

### Binary Wire Protocol

Uses PostgreSQL's binary protocol instead of text format:
- **No string parsing** - Integers, floats, timestamps decoded directly from binary
- **50-70% less data** - Binary integers are 4-8 bytes vs variable-length text
- **Reduced CPU** - No `parseInt`/`parseFloat` on hot paths

```javascript
// Binary protocol: 4 bytes for int32
// Text protocol: "12345678" = 8 bytes + parsing
```

### Tagged Template Identity Caching

Exploits JavaScript's template literal identity for O(1) prepared statement lookup:

```javascript
// Same strings array reference for identical templates
await sql`SELECT * FROM users WHERE id = ${1}`;
await sql`SELECT * FROM users WHERE id = ${2}`;

// Internal: WeakMap<strings, PreparedQuery>
// First call: parse + prepare (~1ms)
// Subsequent calls: direct lookup (~0.001ms)
```

### Automatic Prepared Statements

All queries become server-side prepared statements:
- **Parse once, execute many** - Query plan cached on database server
- **Parameter binding** - Values sent separately, no SQL injection possible
- **Reduced parsing** - Database skips SQL parsing on repeated queries

### Connection Pooling

Native connection pool with health checking:

```javascript
const db = new SQL('postgres://localhost/mydb', {
  max: 20,              // Maximum connections
  idleTimeout: 30000,   // Reclaim idle connections
  maxLifetime: 3600000, // Prevent connection aging issues
});
```

- **Connection reuse** - Avoids TCP/TLS handshake overhead (~10-50ms per connection)
- **Automatic health checks** - Dead connections detected and replaced
- **Queue management** - Requests wait for available connections under load

### Result Format Optimizations

```javascript
// Objects (default) - convenient but allocates per row
const users = await sql`SELECT * FROM users`;

// Arrays - 30-40% faster, less memory
const users = await sql`SELECT * FROM users`.values();

// Streaming - constant memory for large results
for await (const row of sql`SELECT * FROM large_table`.stream()) {
  processRow(row);
}
```

### SQLite In-Process

SQLite queries execute in-process via `node:sqlite`:
- **No network round-trip** - Queries execute in microseconds
- **Shared memory** - Results read directly from SQLite's page cache
- **WAL mode** - Concurrent readers with single writer

## Tips

1. **Always use tagged templates** - Never concatenate user input into SQL strings.

2. **Use transactions for multiple writes** - Ensures data consistency if something fails.

3. **Stream large results** - Use `.stream()` or `.cursor()` to avoid memory issues.

4. **Close connections** - Call `sql.close()` when your app shuts down.

5. **Handle errors** - Different databases have different error codes.

6. **Use `.values()` for performance** - When you don't need column names, arrays are faster.

7. **Reserve connections sparingly** - They hold a database connection exclusively.

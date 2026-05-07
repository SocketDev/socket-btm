# SQL

<!--introduced_in=v23.0.0-->

> Stability: 1 - Experimental

<!-- source_link=lib/smol-sql.js -->

Unified SQL API for PostgreSQL and SQLite with a Bun-compatible interface.
Features tagged template literals for safe parameterized queries.

```mjs
import { sql, SQL } from 'node:smol-sql'
// or
import sql from 'node:smol-sql'
```

```cjs
const { sql, SQL } = require('node:smol-sql')
// or
const sql = require('node:smol-sql').default
```

## Quick start

```mjs
import { sql, SQL } from 'node:smol-sql'

// Using environment variables (POSTGRES_URL or DATABASE_URL)
const users = await sql`SELECT * FROM users WHERE active = ${true}`

// Explicit PostgreSQL connection
const pg = new SQL('postgres://user:pass@localhost:5432/mydb')
const result = await pg`SELECT * FROM users`

// SQLite (in-memory)
const db = new SQL(':memory:')
await db`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`
await db`INSERT INTO users (name) VALUES (${'Alice'})`
```

## `sql` template tag

<!-- YAML
added: v23.0.0
-->

- Returns: {Promise<Array>} Query results.

The default `sql` export is a tagged template literal that uses the connection
URL from `POSTGRES_URL` or `DATABASE_URL` environment variables.

```mjs
import { sql } from 'node:smol-sql'

// Safe parameterized queries - values are automatically escaped
const userId = 1
const users = await sql`SELECT * FROM users WHERE id = ${userId}`

// Multiple parameters
const name = 'Alice'
const age = 30
await sql`INSERT INTO users (name, age) VALUES (${name}, ${age})`
```

## Class: `SQL`

<!-- YAML
added: v23.0.0
-->

Main SQL client class supporting PostgreSQL and SQLite.

### `new SQL(connectionString[, options])`

- `connectionString` {string} Database connection URL or path.
  - `postgres://user:pass@host:port/database` - PostgreSQL
  - `postgresql://...` - PostgreSQL (alias)
  - `:memory:` - SQLite in-memory database
  - `sqlite://./path/to/db.sqlite` - SQLite file
  - `./path/to/db.sqlite` - SQLite file (shorthand)
- `options` {Object} Connection options. **Optional.**
  - `max` {number} Maximum pool connections (PostgreSQL). **Default:** `10`
  - `idleTimeout` {number} Idle connection timeout in seconds. **Default:** `30`
  - `connectionTimeout` {number} Connection timeout in seconds. **Default:** `30`

```mjs
// PostgreSQL
const pg = new SQL('postgres://localhost:5432/mydb')

// SQLite in-memory
const memDb = new SQL(':memory:')

// SQLite file
const fileDb = new SQL('sqlite://./data/app.db')
```

### `sql\`query\`` (template literal)

- Returns: {Promise<Array>} Query results.

Executes a parameterized query using tagged template literals.

```mjs
const db = new SQL(':memory:')

// Create table
await db`CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL
)`

// Insert with parameters
const name = 'Widget'
const price = 9.99
await db`INSERT INTO products (name, price) VALUES (${name}, ${price})`

// Select with parameters
const minPrice = 5
const products = await db`SELECT * FROM products WHERE price >= ${minPrice}`
```

### `sql.begin(callback)`

<!-- YAML
added: v23.0.0
-->

- `callback` {Function} Transaction callback receiving a transaction object.
- Returns: {Promise<any>} Result of the callback.

Executes queries within a transaction. Automatically commits on success or
rolls back on error.

```mjs
const db = new SQL('postgres://localhost/mydb')

await db.begin(async tx => {
  await tx`INSERT INTO accounts (name, balance) VALUES (${'Alice'}, ${1000})`
  await tx`INSERT INTO accounts (name, balance) VALUES (${'Bob'}, ${500})`

  // Transfer funds
  await tx`UPDATE accounts SET balance = balance - 100 WHERE name = ${'Alice'}`
  await tx`UPDATE accounts SET balance = balance + 100 WHERE name = ${'Bob'}`
})
// Transaction is committed automatically

// On error, transaction is rolled back
try {
  await db.begin(async tx => {
    await tx`UPDATE accounts SET balance = balance - 1000 WHERE name = ${'Alice'}`
    throw new Error('Abort transfer')
  })
} catch (err) {
  // Transaction was rolled back
}
```

### `sql.reserve()`

<!-- YAML
added: v23.0.0
-->

- Returns: {Promise<ReservedConnection>} Reserved connection.

Reserves a connection from the pool for exclusive use.

```mjs
const reserved = await db.reserve()
try {
  await reserved`SET search_path TO myschema`
  await reserved`SELECT * FROM users`
} finally {
  reserved.release()
}
```

### `sql.end()`

<!-- YAML
added: v23.0.0
-->

- Returns: {Promise<void>}

Closes the connection pool.

```mjs
await db.end()
```

## Class: `Transaction`

<!-- YAML
added: v23.0.0
-->

Transaction context for executing queries within a transaction.

### `tx\`query\`` (template literal)

Execute a query within the transaction.

### `tx.savepoint(callback)`

<!-- YAML
added: v23.0.0
-->

- `callback` {Function} Savepoint callback.
- Returns: {Promise<any>}

Creates a savepoint within the transaction.

```mjs
await db.begin(async tx => {
  await tx`INSERT INTO logs (message) VALUES (${'Start'})`

  try {
    await tx.savepoint(async sp => {
      await sp`INSERT INTO logs (message) VALUES (${'Risky operation'})`
      throw new Error('Oops')
    })
  } catch {
    // Savepoint rolled back, but transaction continues
  }

  await tx`INSERT INTO logs (message) VALUES (${'End'})`
})
```

## Class: `Savepoint`

<!-- YAML
added: v23.0.0
-->

Savepoint context within a transaction.

## Class: `ReservedConnection`

<!-- YAML
added: v23.0.0
-->

A connection reserved from the pool.

### `reserved.release()`

Returns the connection to the pool.

## Class: `SQLQuery`

<!-- YAML
added: v23.0.0
-->

Represents a parameterized SQL query.

## Class: `SQLFragment`

<!-- YAML
added: v23.0.0
-->

Represents a raw SQL fragment for dynamic query building.

```mjs
import { SQL, SQLFragment } from 'node:smol-sql'

const db = new SQL(':memory:')
const orderBy = new SQLFragment('ORDER BY created_at DESC')
const users = await db`SELECT * FROM users ${orderBy}`
```

## Error classes

### Class: `SQLError`

<!-- YAML
added: v23.0.0
-->

Base error class for SQL errors.

### Class: `PostgresError`

<!-- YAML
added: v23.0.0
-->

PostgreSQL-specific error with additional properties:

- `code` {string} PostgreSQL error code (e.g., `'23505'` for unique violation)
- `detail` {string} Error detail message
- `hint` {string} Error hint
- `position` {number} Error position in query

### Class: `SQLiteError`

<!-- YAML
added: v23.0.0
-->

SQLite-specific error.

## Example: Full application

```mjs
import { SQL } from 'node:smol-sql'

const db = new SQL(':memory:')

// Schema setup
await db`CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`

await db`CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`

// Create user
async function createUser(email, name) {
  const [user] = await db`
    INSERT INTO users (email, name)
    VALUES (${email}, ${name})
    RETURNING *
  `
  return user
}

// Create post with transaction
async function createPost(userId, title, content) {
  return await db.begin(async tx => {
    const [post] = await tx`
      INSERT INTO posts (user_id, title, content)
      VALUES (${userId}, ${title}, ${content})
      RETURNING *
    `

    await tx`
      UPDATE users
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ${userId}
    `

    return post
  })
}

// Query with join
async function getUserPosts(userId) {
  return await db`
    SELECT p.*, u.name as author_name
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ${userId}
    ORDER BY p.created_at DESC
  `
}

// Usage
const alice = await createUser('alice@example.com', 'Alice')
await createPost(alice.id, 'Hello World', 'My first post!')
const posts = await getUserPosts(alice.id)
console.log(posts)

await db.end()
```

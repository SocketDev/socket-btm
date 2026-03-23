# ILP

<!--introduced_in=v23.0.0-->

> Stability: 1 - Experimental

<!-- source_link=lib/smol-ilp.js -->

High-performance ILP (InfluxDB Line Protocol) client for time-series data
ingestion to QuestDB, InfluxDB, and compatible databases.

```mjs
import { Sender, TimeUnit } from 'node:smol-ilp';
// or
import Sender from 'node:smol-ilp';
```

```cjs
const { Sender, TimeUnit } = require('node:smol-ilp');
// or
const Sender = require('node:smol-ilp').default;
```

## Quick start

```mjs
import { Sender, TimeUnit } from 'node:smol-ilp';

const sender = new Sender({ host: 'localhost', port: 9009 });
await sender.connect();

// Write a row
sender
  .table('trades')
  .symbol('ticker', 'AAPL')
  .floatColumn('price', 175.50)
  .intColumn('volume', 1000)
  .atNow();

// Flush to database
await sender.flush();
await sender.close();
```

## Class: `Sender`

<!-- YAML
added: v23.0.0
-->

The main ILP client class for sending time-series data.

### `new Sender(options)`

* `options` {Object}
  * `host` {string} Database host. **Default:** `'localhost'`
  * `port` {number} Database port. **Default:** `9009`
  * `bufferSize` {number} Internal buffer size in bytes. **Default:** `65536`
  * `maxBufferSize` {number} Maximum buffer size. **Default:** `104857600` (100MB)
  * `autoFlush` {boolean} Auto-flush when buffer is full. **Default:** `true`
  * `flushInterval` {number} Auto-flush interval in ms. **Default:** `1000`

Creates a new ILP sender instance.

```mjs
const sender = new Sender({
  host: 'questdb.example.com',
  port: 9009,
  bufferSize: 131072,      // 128KB initial buffer
  autoFlush: true,
  flushInterval: 500,      // Flush every 500ms
});
```

### `sender.connect()`

<!-- YAML
added: v23.0.0
-->

* Returns: {Promise<void>}

Establishes a TCP connection to the database.

```mjs
await sender.connect();
```

### `sender.table(name)`

<!-- YAML
added: v23.0.0
-->

* `name` {string} Table name.
* Returns: {Sender} The sender instance for chaining.

Starts a new row with the specified table name.

```mjs
sender.table('measurements');
```

### `sender.symbol(name, value)`

<!-- YAML
added: v23.0.0
-->

* `name` {string} Symbol (tag) name.
* `value` {string} Symbol value.
* Returns: {Sender} The sender instance for chaining.

Adds a symbol (indexed tag) column. Symbols are indexed for fast filtering.

```mjs
sender
  .table('cpu')
  .symbol('host', 'server1')
  .symbol('region', 'us-east');
```

### `sender.stringColumn(name, value)`

<!-- YAML
added: v23.0.0
-->

* `name` {string} Column name.
* `value` {string} String value.
* Returns: {Sender} The sender instance for chaining.

Adds a string column (not indexed).

```mjs
sender.stringColumn('message', 'System started');
```

### `sender.boolColumn(name, value)`

<!-- YAML
added: v23.0.0
-->

* `name` {string} Column name.
* `value` {boolean} Boolean value.
* Returns: {Sender} The sender instance for chaining.

Adds a boolean column.

```mjs
sender.boolColumn('active', true);
```

### `sender.intColumn(name, value)`

<!-- YAML
added: v23.0.0
-->

* `name` {string} Column name.
* `value` {number|bigint} Integer value.
* Returns: {Sender} The sender instance for chaining.

Adds an integer column.

```mjs
sender.intColumn('count', 42);
sender.intColumn('bigValue', 9007199254740993n);
```

### `sender.floatColumn(name, value)`

<!-- YAML
added: v23.0.0
-->

* `name` {string} Column name.
* `value` {number} Float value.
* Returns: {Sender} The sender instance for chaining.

Adds a floating-point column.

```mjs
sender.floatColumn('temperature', 23.5);
```

### `sender.timestampColumn(name, value[, unit])`

<!-- YAML
added: v23.0.0
-->

* `name` {string} Column name.
* `value` {number|bigint} Timestamp value.
* `unit` {TimeUnit} Timestamp unit. **Default:** `TimeUnit.Microseconds`
* Returns: {Sender} The sender instance for chaining.

Adds a timestamp column.

```mjs
sender.timestampColumn('created_at', Date.now(), TimeUnit.Milliseconds);
```

### `sender.at(timestamp[, unit])`

<!-- YAML
added: v23.0.0
-->

* `timestamp` {number|bigint} Row timestamp.
* `unit` {TimeUnit} Timestamp unit. **Default:** `TimeUnit.Nanoseconds`

Finalizes the row with a designated timestamp.

```mjs
sender
  .table('events')
  .symbol('type', 'click')
  .intColumn('count', 1)
  .at(Date.now() * 1000000); // Convert ms to ns
```

### `sender.atNow()`

<!-- YAML
added: v23.0.0
-->

Finalizes the row using the server's current timestamp.

```mjs
sender
  .table('events')
  .symbol('type', 'click')
  .atNow();
```

### `sender.flush()`

<!-- YAML
added: v23.0.0
-->

* Returns: {Promise<void>}

Sends all buffered data to the database.

```mjs
await sender.flush();
```

### `sender.close()`

<!-- YAML
added: v23.0.0
-->

* Returns: {Promise<void>}

Flushes remaining data and closes the connection.

```mjs
await sender.close();
```

### `sender.reset()`

<!-- YAML
added: v23.0.0
-->

Clears the internal buffer without sending data.

## Class: `BulkRowBuilder`

<!-- YAML
added: v23.0.0
-->

Optimized builder for high-volume row construction.

### `new BulkRowBuilder(sender)`

* `sender` {Sender} The sender to write rows to.

### `bulkRowBuilder.addRow(table, symbols, columns[, timestamp])`

* `table` {string} Table name.
* `symbols` {Object} Symbol name-value pairs.
* `columns` {Object} Column name-value pairs.
* `timestamp` {number|bigint} Row timestamp. **Optional.**

Adds a row in a single call.

```mjs
const bulk = new BulkRowBuilder(sender);

bulk.addRow('trades',
  { ticker: 'AAPL', exchange: 'NASDAQ' },
  { price: 175.50, volume: 1000 }
);

bulk.addRow('trades',
  { ticker: 'GOOGL', exchange: 'NASDAQ' },
  { price: 141.25, volume: 500 }
);
```

## `TimeUnit`

<!-- YAML
added: v23.0.0
-->

Enum for timestamp units.

* `TimeUnit.Nanoseconds` - Nanoseconds (10^-9 seconds)
* `TimeUnit.Microseconds` - Microseconds (10^-6 seconds)
* `TimeUnit.Milliseconds` - Milliseconds (10^-3 seconds)
* `TimeUnit.Seconds` - Seconds

```mjs
import { TimeUnit } from 'node:smol-ilp';

// Use with timestamps
sender.at(Date.now(), TimeUnit.Milliseconds);
sender.timestampColumn('ts', process.hrtime.bigint(), TimeUnit.Nanoseconds);
```

## Class: `ILPError`

<!-- YAML
added: v23.0.0
-->

Error class for ILP-related errors.

### `ilpError.code`

* {string} Error code from `ErrorCodes`.

### `ilpError.message`

* {string} Human-readable error message.

## `ErrorCodes`

<!-- YAML
added: v23.0.0
-->

Constants for error codes.

* `ErrorCodes.CONNECTION_ERROR` - Connection failed
* `ErrorCodes.BUFFER_OVERFLOW` - Buffer size exceeded
* `ErrorCodes.INVALID_DATA` - Invalid data format
* `ErrorCodes.WRITE_ERROR` - Write operation failed

## Example: High-throughput ingestion

```mjs
import { Sender, TimeUnit } from 'node:smol-ilp';

const sender = new Sender({
  host: 'localhost',
  port: 9009,
  bufferSize: 1048576,     // 1MB buffer
  autoFlush: true,
  flushInterval: 100,      // Fast flush for real-time
});

await sender.connect();

// Ingest 100K rows
for (let i = 0; i < 100000; i++) {
  sender
    .table('metrics')
    .symbol('host', `server${i % 10}`)
    .symbol('metric', 'cpu_usage')
    .floatColumn('value', Math.random() * 100)
    .intColumn('cores', 8)
    .atNow();
}

// Final flush and close
await sender.flush();
await sender.close();
```

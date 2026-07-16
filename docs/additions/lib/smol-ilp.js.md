# smol-ilp.js -- Public entry point for node:smol-ilp

## What This File Does

This is the module a user imports with `require('node:smol-ilp')`.
It re-exports everything from the internal implementation file
(lib/internal/socketsecurity/ilp.js) through a frozen object so the
public API cannot be monkey-patched.

ILP (Influx Line Protocol) is a text format for sending time-series
data to databases like QuestDB or InfluxDB. Each row contains a table
name, optional tags, data columns, and a timestamp.

## Exported Classes / Objects

Sender -- The main class. Connect, build rows, flush, close.
BulkRowBuilder -- Helper that batches many rows before flushing.
TimeUnit -- Constants (Nanoseconds, Microseconds, ...) and
conversion helpers.
ILPError -- Custom error class with machine-readable .code.
ErrorCodes -- String constants for ILPError.code values.

## Usage Example

```js
const { Sender } = require('node:smol-ilp')

const sender = new Sender({ host: 'localhost', port: 9009 })
await sender.connect()

sender
  .table('trades')
  .symbol('ticker', 'AAPL')
  .floatColumn('price', 175.5)
  .intColumn('volume', 1000)
  .atNow()

await sender.flush()
await sender.close()
```

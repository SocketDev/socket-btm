# ilp.js -- Internal implementation of the node:smol-ilp module

## What This File Does

Implements the user-facing JavaScript API for ILP (Influx Line Protocol).
ILP is a text format for writing time-series data (think stock ticks,
sensor readings, request logs) into databases like QuestDB and InfluxDB.

The main class is Sender, which provides a fluent (chainable) API:

    sender.table('trades')
      .symbol('ticker', 'AAPL')     // indexed tag
      .floatColumn('price', 175.5)  // data column
      .intColumn('volume', 1000)    // data column
      .atNow();                     // finalize row with current time

Rows accumulate in a C++ buffer (IlpEncoder). Calling sender.flush()
sends the buffer over TCP (IlpTransport) to the database.

## Architecture Overview

```
  JavaScript (this file)           C++ (ilp_binding.cc)
  --------------------------       -------------------------
  Sender class                     internalBinding('smol_ilp')
    .table(name) ──────────────>     binding.table(id, name)
    .floatColumn(n, v) ────────>     binding.floatColumn(id, n, v)
    .flush() ──────────────────>     binding.flush(id)
                                       └─> encoder->Data() + transport->Send()
```

This file handles: - Input validation (type checks, range checks) - Auto-flush (row count threshold & timer interval) - Buffer back-pressure events (75% high, 90% critical) - Connection string parsing - BulkRowBuilder for batch inserts

## The "Sender" Pattern

Each Sender owns a numeric ID (this[kId]) that maps to a C++
SenderState containing an IlpEncoder + IlpTransport. Every method
passes this ID to the native binding. This avoids passing raw C++
pointers to JavaScript.

## Node.js Internal Module Conventions

- "primordials" are frozen built-in functions (ArrayIsArray, DateNow,
  etc.) that cannot be monkey-patched by user code.
- "internalBinding" loads C++ modules registered with
  NODE_BINDING_CONTEXT_AWARE_INTERNAL.
- Symbols (kId, kConnected, ...) are used for private state so it
  does not appear in console.log or Object.keys.

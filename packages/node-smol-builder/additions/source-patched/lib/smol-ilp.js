'use strict';

// node:smol-ilp - High-performance ILP (InfluxDB Line Protocol) client
// For time-series data ingestion to QuestDB, InfluxDB, and compatible databases.
//
// Usage:
//   import { Sender, TimeUnit } from 'node:smol-ilp';
//
//   const sender = new Sender({ host: 'localhost', port: 9009 });
//   await sender.connect();
//
//   sender
//     .table('trades')
//     .symbol('ticker', 'AAPL')
//     .floatColumn('price', 175.50)
//     .intColumn('volume', 1000)
//     .atNow();
//
//   await sender.flush();
//   await sender.close();

const {
  ObjectFreeze,
} = primordials;

const {
  Sender,
  BulkRowBuilder,
  TimeUnit,
  ILPError,
  ErrorCodes,
} = require('internal/socketsecurity/ilp');

module.exports = ObjectFreeze({
  __proto__: null,
  Sender,
  BulkRowBuilder,
  TimeUnit,
  ILPError,
  ErrorCodes,
  default: Sender,
});

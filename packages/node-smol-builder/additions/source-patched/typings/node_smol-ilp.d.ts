/**
 * node:smol-ilp - High-Performance InfluxDB Line Protocol Client
 *
 * A zero-overhead time-series data sender using the InfluxDB Line Protocol (ILP).
 * Compatible with QuestDB, InfluxDB, and other ILP-compatible databases.
 *
 * Performance features:
 * - **Direct TCP**: Native Bun TCP socket for minimal overhead
 * - **Buffer pooling**: Reuses buffers to minimize allocations
 * - **Batch inserts**: Configurable auto-flush by row count or interval
 * - **Streaming writes**: No intermediate object creation
 * - **Fluent API**: Chainable methods for ergonomic batch building
 *
 * @example
 * ```ts
 * import { Sender } from 'node:smol-ilp';
 *
 * const sender = new Sender({ host: 'localhost', port: 9009 });
 * await sender.connect();
 *
 * // High-throughput batch insert
 * for (const trade of trades) {
 *   sender
 *     .table('trades')
 *     .symbol('ticker', trade.ticker)
 *     .float('price', trade.price)
 *     .int('volume', trade.volume)
 *     .atNow();
 * }
 *
 * await sender.flush();
 * await sender.close();
 * ```
 *
 * @module
 */
declare module 'node:smol-ilp' {
  import { EventEmitter } from 'events'

  /** Timestamp units for ILP protocol */
  export const TimeUnit: Readonly<{
    Nanoseconds: 0
    Microseconds: 1
    Milliseconds: 2
    Seconds: 3
    /** Get the current timestamp in the specified unit */
    now(unit?: TimeUnitValue): bigint
    /** Convert a Date object to timestamp in the specified unit */
    fromDate(date: Date, unit?: TimeUnitValue): bigint
    /** Convert timestamp from one unit to another */
    convert(
      value: number | bigint,
      fromUnit: TimeUnitValue,
      toUnit: TimeUnitValue,
    ): bigint
  }>

  export type TimeUnitValue = 0 | 1 | 2 | 3

  /** ILP Error codes for programmatic error handling */
  export type ILPErrorCode =
    | 'ERR_ILP_CLOSED'
    | 'ERR_ILP_CONNECTION_FAILED'
    | 'ERR_ILP_NOT_CONNECTED'
    | 'ERR_ILP_NO_TABLE'
    | 'ERR_ILP_FLUSH_FAILED'
    | 'ERR_ILP_BUFFER_OVERFLOW'
    | 'ERR_ILP_INVALID_ARGUMENT'

  /** Error codes constant */
  export const ErrorCodes: Readonly<{
    CLOSED: 'ERR_ILP_CLOSED'
    CONNECTION_FAILED: 'ERR_ILP_CONNECTION_FAILED'
    NOT_CONNECTED: 'ERR_ILP_NOT_CONNECTED'
    NO_TABLE: 'ERR_ILP_NO_TABLE'
    FLUSH_FAILED: 'ERR_ILP_FLUSH_FAILED'
    BUFFER_OVERFLOW: 'ERR_ILP_BUFFER_OVERFLOW'
    INVALID_ARGUMENT: 'ERR_ILP_INVALID_ARGUMENT'
  }>

  /** Error class for ILP operations */
  export class ILPError extends Error {
    code: ILPErrorCode
    constructor(message: string, code: ILPErrorCode)
  }

  /** Sender options */
  export interface SenderOptions {
    /** Host to connect to (default: 'localhost') */
    host?: string
    /** Port to connect to (default: 9009) */
    port?: number
    /** Connection timeout in ms (default: 10000) */
    connectTimeout?: number
    /** Send timeout in ms (default: 30000) */
    sendTimeout?: number
    /** Initial buffer size (default: 65536) */
    bufferSize?: number
    /** Maximum buffer size (default: 104857600 = 100MB) */
    maxBufferSize?: number
    /** Enable auto-flush (default: false) */
    autoFlush?: boolean
    /** Flush after this many rows (default: 1000) */
    autoFlushRows?: number
    /** Flush interval in ms (0 = disabled, default: 0) */
    autoFlushInterval?: number
  }

  /** Sender statistics */
  export interface SenderStats {
    rowsBuffered: number
    rowsSent: number
    bytesSent: number
    bytesBuffered: number
    lastError?: string
  }

  /** Flush event stats */
  export interface FlushStats {
    rowsSent: number
    bytesSent: number
  }

  /** Timestamp column specification */
  export interface TimestampSpec {
    value: number | bigint
    unit?: TimeUnitValue
  }

  /** Row data for insertRow convenience method */
  export interface RowData {
    /** Symbol (tag) columns - indexed for filtering */
    symbols?: Record<string, string>
    /** Field columns - actual data values */
    fields?: Record<string, string | boolean | number | bigint>
    /** Timestamp columns */
    timestamps?: Record<string, TimestampSpec | number | bigint>
    /** Row timestamp */
    timestamp?: number | bigint
    /** Timestamp unit (default: TimeUnit.Nanoseconds) */
    timestampUnit?: TimeUnitValue
  }

  /** Buffer pressure info */
  export interface BufferPressureInfo {
    bytesUsed: number
    bytesMax: number
    percentUsed: number
  }

  /** Warning info */
  export interface WarningInfo {
    type: string
    message: string
    table?: string
  }

  /** Sender events */
  export interface SenderEvents {
    /** Emitted when connection is established */
    connect: []
    /** Emitted when connection is closed */
    disconnect: []
    /** Emitted after successful flush */
    flush: [stats: FlushStats]
    /** Emitted on errors (including auto-flush errors) */
    error: [error: Error]
    /**
     * Emitted when buffer reaches 75% capacity.
     * Recommended action: Consider calling flush() soon to prevent data loss.
     * @example
     * sender.on('bufferPressure', (info) => {
     *   console.warn(`Buffer at ${info.percentUsed}%, scheduling flush`);
     *   setImmediate(() => sender.flush());
     * });
     */
    bufferPressure: [info: BufferPressureInfo]
    /**
     * Emitted when buffer reaches 90% capacity.
     * Recommended action: Call flush() immediately to prevent data loss.
     * @example
     * sender.on('bufferCritical', async (info) => {
     *   console.error(`Buffer critical at ${info.percentUsed}%! Flushing immediately.`);
     *   await sender.flush();
     * });
     */
    bufferCritical: [info: BufferPressureInfo]
    /** Emitted for warnings (e.g., empty rows) */
    warning: [info: WarningInfo]
  }

  /**
   * ILP Sender - High-performance time-series data sender.
   * Extends EventEmitter for event-based error and status handling.
   *
   * Events:
   * - 'connect' - Emitted when connection is established
   * - 'disconnect' - Emitted when connection is closed
   * - 'flush' - Emitted after successful flush with { rowsSent, bytesSent }
   * - 'error' - Emitted on errors (including auto-flush errors)
   * - 'bufferPressure' - Emitted when buffer reaches 75% (consider flushing soon)
   * - 'bufferCritical' - Emitted when buffer reaches 90% (flush immediately)
   *
   * @example
   * const sender = new Sender({ host: 'localhost', port: 9009 });
   * sender.on('error', (err) => console.error('ILP error:', err));
   * sender.on('flush', (stats) => console.log('Flushed:', stats));
   * sender.on('bufferPressure', () => setImmediate(() => sender.flush()));
   * sender.on('bufferCritical', () => sender.flush());
   * await sender.connect();
   *
   * sender
   *   .table('trades')
   *   .symbol('ticker', 'AAPL')
   *   .floatColumn('price', 175.50)
   *   .intColumn('volume', 1000)
   *   .atNow();
   *
   * await sender.flush();
   * await sender.close();
   */
  export class Sender extends EventEmitter {
    constructor(options?: SenderOptions)

    /** Connect to the ILP server */
    connect(): Promise<void>

    /** Start a new row with the given table name */
    table(name: string): this

    /** Add a symbol (tag) column - indexed for fast filtering */
    symbol(name: string, value: string): this

    /** Add a string column */
    stringColumn(name: string, value: string): this

    /** Add a boolean column */
    boolColumn(name: string, value: boolean): this

    /** Add an integer column */
    intColumn(name: string, value: number | bigint): this

    /** Add a float column */
    floatColumn(name: string, value: number): this

    /** Add a timestamp column */
    timestampColumn(
      name: string,
      value: number | bigint,
      unit?: TimeUnitValue,
    ): this

    // Column method aliases (for more intuitive API)

    /** Alias for symbol() - add a tag column (InfluxDB terminology) */
    tag(name: string, value: string): this

    /** Alias for intColumn() - add an integer column */
    int(name: string, value: number | bigint): this

    /** Alias for floatColumn() - add a float column */
    float(name: string, value: number): this

    /** Alias for boolColumn() - add a boolean column */
    bool(name: string, value: boolean): this

    /** Alias for stringColumn() - add a string column */
    str(name: string, value: string): this

    /** Smart field column - auto-detects type based on value */
    field(name: string, value: string | boolean | number | bigint): this

    /** Finalize the current row with an explicit timestamp */
    at(timestamp: number | bigint, unit?: TimeUnitValue): this

    /** Finalize the current row with the current timestamp */
    atNow(): this

    /** Flush buffered data to the server */
    flush(): Promise<void>

    /** Clear the buffer without sending */
    clear(): this

    /** Close the sender and release resources */
    close(): Promise<void>

    /** Insert a complete row in one call (convenience method) */
    insertRow(tableName: string, data?: RowData): this

    /** Insert multiple rows in one call (batch convenience method) */
    insertRows(tableName: string, rows: RowData[]): this

    /** Get sender statistics */
    readonly stats: SenderStats

    /** Check if sender is connected */
    readonly connected: boolean

    /** Check if sender is closed */
    readonly closed: boolean

    /** Get available buffer space in bytes */
    readonly bufferAvailable: number

    /** Get used buffer space in bytes */
    readonly bufferUsed: number

    /** Check if buffer is under pressure (>= 75% full) */
    isBufferPressured(): boolean

    /** Check if buffer is critically full (>= 90% full) */
    isBufferCritical(): boolean

    /**
     * Send data in a single fire-and-forget operation.
     * Creates a sender, connects, inserts rows, flushes, and closes.
     *
     * @example
     * await Sender.sendOnce({ host: 'localhost' }, 'trades', { symbols: { ticker: 'AAPL' }, fields: { price: 175.50 } });
     */
    static sendOnce(
      options: SenderOptions,
      tableName: string,
      rowsOrRow: RowData | RowData[],
    ): Promise<void>

    /**
     * Create a Sender from a connection string.
     * Supports formats: host:port, tcp://host:port, ilp://host:port
     * Query string params are mapped to options.
     *
     * @example
     * const sender = Sender.fromConnectionString('localhost:9009');
     * const sender2 = Sender.fromConnectionString('ilp://db.example.com:9009?bufferSize=131072');
     */
    static fromConnectionString(connectionString: string): Sender

    // EventEmitter typed methods
    on<K extends keyof SenderEvents>(
      event: K,
      listener: (...args: SenderEvents[K]) => void,
    ): this
    once<K extends keyof SenderEvents>(
      event: K,
      listener: (...args: SenderEvents[K]) => void,
    ): this
    off<K extends keyof SenderEvents>(
      event: K,
      listener: (...args: SenderEvents[K]) => void,
    ): this
    removeListener<K extends keyof SenderEvents>(
      event: K,
      listener: (...args: SenderEvents[K]) => void,
    ): this
    emit<K extends keyof SenderEvents>(
      event: K,
      ...args: SenderEvents[K]
    ): boolean
    listenerCount(eventName?: string | symbol): number
  }

  /** BulkRowBuilder options */
  export interface BulkRowBuilderOptions {
    /** Rows per batch before auto-flush (default: 1000) */
    batchSize?: number
  }

  /** BulkRowBuilder stats */
  export interface BulkRowBuilderStats {
    pending: number
    totalAdded: number
    totalFlushed: number
  }

  /**
   * Bulk row builder for efficient batch row construction with auto-batching.
   * Collects rows and automatically batches them to a sender.
   *
   * @example
   * const builder = new BulkRowBuilder(sender, 'trades', { batchSize: 100 });
   * for (const trade of trades) {
   *   builder.add({ symbols: { ticker: trade.ticker }, fields: { price: trade.price } });
   * }
   * await builder.finish(); // Flush any remaining rows
   */
  export class BulkRowBuilder {
    constructor(sender: Sender, table: string, options?: BulkRowBuilderOptions)

    /** Add a row to the batch */
    add(data: RowData): this

    /** Add multiple rows to the batch */
    addMany(rows: RowData[]): this

    /** Finish building and flush all remaining rows */
    finish(): Promise<{ totalAdded: number; totalFlushed: number }>

    /** Get current stats */
    readonly stats: BulkRowBuilderStats
  }
}

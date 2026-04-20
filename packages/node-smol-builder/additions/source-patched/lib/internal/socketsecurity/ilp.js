'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/ilp.js.md

const {
  ArrayIsArray,
  ArrayPrototypePush,
  BigInt: BigIntCtor,
  DateNow,
  DatePrototypeGetTime,
  Error: ErrorCtor,
  ErrorCaptureStackTrace,
  hardenRegExp,
  MathFloor,
  NumberIsFinite,
  NumberIsInteger,
  NumberParseInt,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectHasOwn,
  ObjectKeys,
  ObjectSetPrototypeOf,
  String: StringCtor,
  StringPrototypeIncludes,
  StringPrototypeLastIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  Symbol: SymbolCtor,
  SymbolToStringTag,
  URL: URLCtor,
  URLSearchParamsPrototypeForEach,
} = primordials

const ErrorProto = ErrorCtor.prototype

const {
  codes: { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE },
} = require('internal/errors')

const {
  validateObject,
  validateString,
  validateNumber,
} = require('internal/validators')
const {
  EventsEventEmitter,
  SetInterval,
  ClearInterval,
} = require('internal/socketsecurity/safe-references')

// Native binding for ILP operations (lazy).
let _ilpBinding
function binding() {
  if (!_ilpBinding) {
    _ilpBinding = internalBinding('smol_ilp')
  }
  return _ilpBinding
}

// Time unit multipliers (nanoseconds, microseconds, milliseconds, seconds).
// Defined at module level to avoid allocation on every convert() call.
const TIME_UNIT_MULTIPLIERS = [1n, 1000n, 1000000n, 1000000000n]

// Pre-compiled regexes for connection string parsing (performance optimization).
const ILP_SCHEME_REGEX = hardenRegExp(/^ilp:\/\//)
const TCP_SCHEME_REGEX = hardenRegExp(/^tcp:\/\//)

// Default stats object (extracted to avoid repeated allocations).
const DEFAULT_STATS = ObjectFreeze({
  __proto__: null,
  rowsBuffered: 0,
  rowsSent: 0,
  bytesSent: 0,
  bytesBuffered: 0,
})

// Timestamp units for ILP protocol.
const TimeUnit = ObjectFreeze({
  __proto__: null,
  Nanoseconds: 0,
  Microseconds: 1,
  Milliseconds: 2,
  Seconds: 3,

  /**
   * Get the current timestamp in the specified unit.
   * @param {number} [unit=TimeUnit.Nanoseconds] - Target unit.
   * @returns {bigint} Current timestamp in the specified unit.
   */
  now(unit = 0) {
    const ms = DateNow()
    switch (unit) {
      case 0: // Nanoseconds
        return BigIntCtor(ms) * 1000000n
      case 1: // Microseconds
        return BigIntCtor(ms) * 1000n
      case 2: // Milliseconds
        return BigIntCtor(ms)
      case 3: // Seconds
        return BigIntCtor(MathFloor(ms / 1000))
      default:
        return BigIntCtor(ms) * 1000000n
    }
  },

  /**
   * Convert a Date object to timestamp in the specified unit.
   * @param {Date} date - Date to convert.
   * @param {number} [unit=TimeUnit.Nanoseconds] - Target unit.
   * @returns {bigint} Timestamp in the specified unit.
   */
  fromDate(date, unit = 0) {
    const ms = DatePrototypeGetTime(date)
    switch (unit) {
      case 0: // Nanoseconds
        return BigIntCtor(ms) * 1000000n
      case 1: // Microseconds
        return BigIntCtor(ms) * 1000n
      case 2: // Milliseconds
        return BigIntCtor(ms)
      case 3: // Seconds
        return BigIntCtor(MathFloor(ms / 1000))
      default:
        return BigIntCtor(ms) * 1000000n
    }
  },

  /**
   * Convert timestamp from one unit to another.
   * @param {number|bigint} value - Timestamp value.
   * @param {number} fromUnit - Source unit.
   * @param {number} toUnit - Target unit.
   * @returns {bigint} Converted timestamp.
   */
  convert(value, fromUnit, toUnit) {
    if (fromUnit === toUnit) {
      // Skip conversion, only convert to bigint if needed
      return typeof value === 'bigint' ? value : BigIntCtor(value)
    }
    // Convert to nanoseconds first, then to target unit
    const inNanos = BigIntCtor(value) * TIME_UNIT_MULTIPLIERS[fromUnit]
    return inNanos / TIME_UNIT_MULTIPLIERS[toUnit]
  },
})

// ILP Error codes for programmatic error handling.
const ErrorCodes = ObjectFreeze({
  __proto__: null,
  CLOSED: 'ERR_ILP_CLOSED',
  CONNECTION_FAILED: 'ERR_ILP_CONNECTION_FAILED',
  NOT_CONNECTED: 'ERR_ILP_NOT_CONNECTED',
  NO_TABLE: 'ERR_ILP_NO_TABLE',
  FLUSH_FAILED: 'ERR_ILP_FLUSH_FAILED',
  BUFFER_OVERFLOW: 'ERR_ILP_BUFFER_OVERFLOW',
  INVALID_ARGUMENT: 'ERR_ILP_INVALID_ARGUMENT',
})

// Symbols for internal state.
const kId = SymbolCtor('kId')
const kConnected = SymbolCtor('kConnected')
const kClosed = SymbolCtor('kClosed')
const kConfig = SymbolCtor('kConfig')
const kCurrentTable = SymbolCtor('kCurrentTable')
const kRowsSinceFlush = SymbolCtor('kRowsSinceFlush')
const kAutoFlushInterval = SymbolCtor('kAutoFlushInterval')
const kHasColumns = SymbolCtor('kHasColumns')
const kPressureEmitted = SymbolCtor('kPressureEmitted')
const kFlushInProgress = SymbolCtor('kFlushInProgress')
const kFlushPromise = SymbolCtor('kFlushPromise')
const kLastRowsSent = SymbolCtor('kLastRowsSent')
const kLastBytesSent = SymbolCtor('kLastBytesSent')

// Buffer pressure thresholds (percentage of maxBufferSize)
const BUFFER_PRESSURE_HIGH = 0.75 // 75% - emit 'bufferPressure' event
const BUFFER_PRESSURE_CRITICAL = 0.9 // 90% - emit 'bufferCritical' event
const BUFFER_PRESSURE_CHECK_INTERVAL = 100 // Check every N rows for performance

/**
 * ILP Error class.
 */
class ILPError extends ErrorCtor {
  constructor(message, code) {
    super(message)
    this.name = 'ILPError'
    this.code = code
    ErrorCaptureStackTrace(this, ILPError)
  }
}

ObjectSetPrototypeOf(ILPError.prototype, ErrorProto)
ObjectSetPrototypeOf(ILPError, ErrorCtor)

/**
 * ILP Sender - High-performance time-series data sender.
 *
 * Events:
 * - 'connect' - Emitted when connection is established.
 * - 'disconnect' - Emitted when connection is closed.
 * - 'flush' - Emitted after successful flush with stats { rowsSent, bytesSent }.
 * - 'error' - Emitted on errors (also during auto-flush).
 *
 * @example
 * const sender = new Sender({ host: 'localhost', port: 9009 });
 * sender.on('error', (err) => console.error('ILP error:', err));
 * sender.on('flush', (stats) => console.log('Flushed:', stats));
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
class Sender extends EventsEventEmitter {
  [kId];
  [kConnected] = false;
  [kClosed] = false;
  [kConfig];
  [kCurrentTable] = undefined;
  [kRowsSinceFlush] = 0;
  [kAutoFlushInterval] = undefined;
  [kHasColumns] = false;
  [kPressureEmitted] = 0; // 0=none, 1=high, 2=critical
  [kFlushInProgress] = false;
  [kFlushPromise] = undefined

  /**
   * Create a new ILP sender.
   * @param {object} options - Configuration options.
   * @param {string} [options.host='localhost'] - Host to connect to.
   * @param {number} [options.port=9009] - Port to connect to.
   * @param {number} [options.connectTimeout=10_000] - Connection timeout in ms.
   * @param {number} [options.sendTimeout=30_000] - Send timeout in ms.
   * @param {number} [options.bufferSize=65536] - Initial buffer size.
   * @param {number} [options.maxBufferSize=104857600] - Maximum buffer size (100MB).
   * @param {boolean} [options.autoFlush=false] - Enable auto-flush.
   * @param {number} [options.autoFlushRows=1000] - Flush after this many rows.
   * @param {number} [options.autoFlushInterval=0] - Flush interval in ms (0 = disabled).
   */
  constructor(options) {
    super()
    const opts = { __proto__: null, ...options }
    validateObject(opts, 'options')

    const config = {
      __proto__: null,
      host: opts.host ?? 'localhost',
      port: opts.port ?? 9009,
      connectTimeout: opts.connectTimeout ?? 10_000,
      sendTimeout: opts.sendTimeout ?? 30_000,
      bufferSize: opts.bufferSize ?? 65536,
      maxBufferSize: opts.maxBufferSize ?? 104857600,
      autoFlush: opts.autoFlush ?? false,
      autoFlushRows: opts.autoFlushRows ?? 1000,
      autoFlushInterval: opts.autoFlushInterval ?? 0,
    }

    validateString(config.host, 'options.host')
    validateNumber(config.port, 'options.port', 1, 65535)
    validateNumber(config.connectTimeout, 'options.connectTimeout', 0)
    validateNumber(config.sendTimeout, 'options.sendTimeout', 0)
    validateNumber(config.bufferSize, 'options.bufferSize', 1024)
    validateNumber(
      config.maxBufferSize,
      'options.maxBufferSize',
      config.bufferSize,
    )
    if (config.autoFlushRows !== undefined) {
      validateNumber(config.autoFlushRows, 'options.autoFlushRows', 1)
    }
    if (config.autoFlushInterval !== undefined) {
      validateNumber(config.autoFlushInterval, 'options.autoFlushInterval', 0)
    }

    this[kConfig] = config
    this[kId] = binding().createSender({
      host: config.host,
      port: config.port,
      connectTimeoutMs: config.connectTimeout,
      sendTimeoutMs: config.sendTimeout,
      bufferSize: config.bufferSize,
      maxBufferSize: config.maxBufferSize,
    })
  }

  /**
   * Connect to the ILP server.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this[kClosed]) {
      throw new ILPError('Sender is closed', ErrorCodes.CLOSED)
    }
    if (this[kConnected]) {
      return
    }

    const result = binding().connect(this[kId])
    if (!result) {
      const error = binding().getStats(this[kId])?.lastError
      throw new ILPError(
        error || 'Failed to connect to ILP server',
        ErrorCodes.CONNECTION_FAILED,
      )
    }
    this[kConnected] = true
    this.emit('connect')

    // Start auto-flush interval if configured
    const { autoFlush, autoFlushInterval } = this[kConfig]
    if (autoFlush && autoFlushInterval > 0) {
      this[kAutoFlushInterval] = SetInterval(() => {
        // Skip if not connected, closed, or flush already in progress
        if (this[kConnected] && !this[kClosed] && !this[kFlushInProgress]) {
          this[kFlushInProgress] = true
          const flushPromise = this.flush()
            .catch(err => {
              // Emit error event for auto-flush failures
              this.emit('error', err)
            })
            .finally(() => {
              this[kFlushInProgress] = false
              this[kFlushPromise] = undefined
            })
          this[kFlushPromise] = flushPromise
        }
      }, autoFlushInterval)
      // Unref so it doesn't keep the process alive
      this[kAutoFlushInterval].unref?.()
    }
  }

  /**
   * Start a new row with the given table name.
   * @param {string} name - Table name.
   * @returns {Sender} this for chaining.
   */
  table(name) {
    this.#checkOpen()
    validateString(name, 'name')
    if (name.length === 0) {
      throw new ERR_INVALID_ARG_VALUE('name', name, 'cannot be empty')
    }
    binding().table(this[kId], name)
    this[kCurrentTable] = name
    return this
  }

  /**
   * Add a symbol (tag) column - indexed for fast filtering.
   * @param {string} name - Column name.
   * @param {string} value - Column value.
   * @returns {Sender} this for chaining.
   */
  symbol(name, value) {
    this.#checkOpen()
    this.#checkTable()
    validateString(name, 'name')
    validateString(value, 'value')
    binding().symbol(this[kId], name, value)
    this[kHasColumns] = true
    return this
  }

  /**
   * Add a string column.
   * @param {string} name - Column name.
   * @param {string} value - Column value.
   * @returns {Sender} this for chaining.
   */
  stringColumn(name, value) {
    this.#checkOpen()
    this.#checkTable()
    validateString(name, 'name')
    validateString(value, 'value')
    binding().stringColumn(this[kId], name, value)
    this[kHasColumns] = true
    return this
  }

  /**
   * Add a boolean column.
   * @param {string} name - Column name.
   * @param {boolean} value - Column value.
   * @returns {Sender} this for chaining.
   */
  boolColumn(name, value) {
    this.#checkOpen()
    this.#checkTable()
    validateString(name, 'name')
    if (typeof value !== 'boolean') {
      throw new ERR_INVALID_ARG_TYPE('value', 'boolean', value)
    }
    binding().boolColumn(this[kId], name, value)
    this[kHasColumns] = true
    return this
  }

  /**
   * Add an integer column.
   * @param {string} name - Column name.
   * @param {number|bigint} value - Column value.
   * @returns {Sender} this for chaining.
   */
  intColumn(name, value) {
    this.#checkOpen()
    this.#checkTable()
    validateString(name, 'name')
    const type = typeof value
    if (type !== 'number' && type !== 'bigint') {
      throw new ERR_INVALID_ARG_TYPE('value', ['number', 'bigint'], value)
    }
    // Validate numbers are finite (bigints can't be NaN/Infinity)
    if (type === 'number' && !NumberIsFinite(value)) {
      throw new ERR_INVALID_ARG_VALUE(
        'value',
        value,
        'must be a finite number or bigint',
      )
    }
    binding().intColumn(this[kId], name, value)
    this[kHasColumns] = true
    return this
  }

  /**
   * Add a float column.
   * @param {string} name - Column name.
   * @param {number} value - Column value.
   * @returns {Sender} this for chaining.
   */
  floatColumn(name, value) {
    this.#checkOpen()
    this.#checkTable()
    validateString(name, 'name')
    if (typeof value !== 'number' || !NumberIsFinite(value)) {
      throw new ERR_INVALID_ARG_TYPE('value', 'finite number', value)
    }
    binding().floatColumn(this[kId], name, value)
    this[kHasColumns] = true
    return this
  }

  /**
   * Add a timestamp column.
   * @param {string} name - Column name.
   * @param {number|bigint} value - Timestamp value.
   * @param {number} [unit=TimeUnit.Nanoseconds] - Timestamp unit.
   * @returns {Sender} this for chaining.
   */
  timestampColumn(name, value, unit = TimeUnit.Nanoseconds) {
    this.#checkOpen()
    this.#checkTable()
    validateString(name, 'name')
    if (typeof value !== 'number' && typeof value !== 'bigint') {
      throw new ERR_INVALID_ARG_TYPE('value', ['number', 'bigint'], value)
    }
    if (unit < 0 || unit > 3) {
      throw new ERR_INVALID_ARG_VALUE(
        'unit',
        unit,
        'must be 0-3 (TimeUnit.Nanoseconds to TimeUnit.Seconds)',
      )
    }
    binding().timestampColumn(this[kId], name, value, unit)
    this[kHasColumns] = true
    return this
  }

  // ============================================================================
  // Column Aliases (for more intuitive API)
  // ============================================================================

  /**
   * Alias for symbol() - add a tag column (InfluxDB terminology).
   * @param {string} name - Column name.
   * @param {string} value - Column value.
   * @returns {Sender} this for chaining.
   */
  tag(name, value) {
    return this.symbol(name, value)
  }

  /**
   * Alias for intColumn() - add an integer column.
   * @param {string} name - Column name.
   * @param {number|bigint} value - Column value.
   * @returns {Sender} this for chaining.
   */
  int(name, value) {
    return this.intColumn(name, value)
  }

  /**
   * Alias for floatColumn() - add a float column.
   * @param {string} name - Column name.
   * @param {number} value - Column value.
   * @returns {Sender} this for chaining.
   */
  float(name, value) {
    return this.floatColumn(name, value)
  }

  /**
   * Alias for boolColumn() - add a boolean column.
   * @param {string} name - Column name.
   * @param {boolean} value - Column value.
   * @returns {Sender} this for chaining.
   */
  bool(name, value) {
    return this.boolColumn(name, value)
  }

  /**
   * Alias for stringColumn() - add a string column.
   * @param {string} name - Column name.
   * @param {string} value - Column value.
   * @returns {Sender} this for chaining.
   */
  str(name, value) {
    return this.stringColumn(name, value)
  }

  /**
   * Smart field column - auto-detects type based on value.
   * @param {string} name - Column name.
   * @param {string|boolean|number|bigint} value - Column value.
   * @returns {Sender} this for chaining.
   */
  field(name, value) {
    const type = typeof value
    if (type === 'string') {
      return this.stringColumn(name, value)
    } else if (type === 'boolean') {
      return this.boolColumn(name, value)
    } else if (type === 'bigint') {
      return this.intColumn(name, value)
    } else if (type === 'number') {
      if (NumberIsInteger(value)) {
        return this.intColumn(name, value)
      }
      return this.floatColumn(name, value)
    }
    throw new ERR_INVALID_ARG_TYPE(
      'value',
      ['string', 'boolean', 'number', 'bigint'],
      value,
    )
  }

  /**
   * Finalize the current row with an explicit timestamp.
   * @param {number|bigint} timestamp - Row timestamp.
   * @param {number} [unit=TimeUnit.Nanoseconds] - Timestamp unit.
   * @returns {Sender} this for chaining.
   */
  at(timestamp, unit = TimeUnit.Nanoseconds) {
    this.#checkOpen()
    this.#checkTable()
    if (typeof timestamp !== 'number' && typeof timestamp !== 'bigint') {
      throw new ERR_INVALID_ARG_TYPE(
        'timestamp',
        ['number', 'bigint'],
        timestamp,
      )
    }
    if (unit < 0 || unit > 3) {
      throw new ERR_INVALID_ARG_VALUE(
        'unit',
        unit,
        'must be 0-3 (TimeUnit.Nanoseconds to TimeUnit.Seconds)',
      )
    }
    // Empty row validation
    if (!this[kHasColumns]) {
      this.#emitEmptyRowWarning()
    }
    binding().at(this[kId], timestamp, unit)
    this[kCurrentTable] = undefined
    this[kHasColumns] = false
    this[kRowsSinceFlush]++
    // Check buffer pressure every N rows (not every row, for performance)
    this.#checkBufferPressure()
    this.#maybeAutoFlush()
    return this
  }

  /**
   * Finalize the current row with the current timestamp.
   * @returns {Sender} this for chaining.
   */
  atNow() {
    this.#checkOpen()
    this.#checkTable()
    // Empty row validation
    if (!this[kHasColumns]) {
      this.#emitEmptyRowWarning()
    }
    binding().atNow(this[kId])
    this[kCurrentTable] = undefined
    this[kHasColumns] = false
    this[kRowsSinceFlush]++
    // Check buffer pressure every N rows (not every row, for performance)
    this.#checkBufferPressure()
    this.#maybeAutoFlush()
    return this
  }

  /**
   * Flush buffered data to the server.
   * @returns {Promise<void>}
   */
  async flush() {
    this.#checkOpen()
    if (!this[kConnected]) {
      throw new ILPError('Not connected', ErrorCodes.NOT_CONNECTED)
    }

    // Use cached stats from previous flush (avoids redundant native call)
    const rowsBefore = this[kLastRowsSent] ?? 0
    const bytesBefore = this[kLastBytesSent] ?? 0

    const result = binding().flush(this[kId])
    this[kRowsSinceFlush] = 0 // Reset counter after flush
    this[kPressureEmitted] = 0 // Reset pressure state after flush

    // Get stats after flush (single native call)
    const statsAfter = binding().getStats(this[kId])
    if (!result) {
      throw new ILPError(
        statsAfter?.lastError || 'Failed to flush data',
        ErrorCodes.FLUSH_FAILED,
      )
    }

    // Cache stats for next flush delta calculation
    const rowsAfter = statsAfter?.rowsSent ?? 0
    const bytesAfter = statsAfter?.bytesSent ?? 0
    this[kLastRowsSent] = rowsAfter
    this[kLastBytesSent] = bytesAfter

    // Emit flush event with delta stats
    this.emit('flush', {
      __proto__: null,
      rowsSent: rowsAfter - rowsBefore,
      bytesSent: bytesAfter - bytesBefore,
    })
  }

  /**
   * Clear the buffer without sending.
   * @returns {Sender} this for chaining.
   */
  clear() {
    this.#checkOpen()
    binding().clear(this[kId])
    this[kCurrentTable] = undefined
    this[kRowsSinceFlush] = 0
    return this
  }

  /**
   * Get sender statistics.
   * @returns {object} Stats object with rowsBuffered, rowsSent, bytesSent, lastError.
   */
  get stats() {
    if (this[kClosed]) {
      return DEFAULT_STATS
    }
    return binding().getStats(this[kId]) ?? DEFAULT_STATS
  }

  /**
   * Check if sender is connected.
   * @returns {boolean}
   */
  get connected() {
    return this[kConnected]
  }

  /**
   * Check if sender is closed.
   * @returns {boolean}
   */
  get closed() {
    return this[kClosed]
  }

  /**
   * Close the sender and release resources.
   * Waits for any in-progress flush to complete before closing.
   * @returns {Promise<void>}
   */
  async close() {
    if (this[kClosed]) {
      return
    }
    this[kClosed] = true
    this[kConnected] = false

    // Clear auto-flush interval first to prevent new flushes
    if (this[kAutoFlushInterval]) {
      ClearInterval(this[kAutoFlushInterval])
      this[kAutoFlushInterval] = undefined
    }

    // Wait for in-progress flush to complete (ignore errors - we're closing anyway)
    if (this[kFlushPromise]) {
      try {
        await this[kFlushPromise]
      } catch {
        // Ignore flush errors during close
      }
    }

    binding().close(this[kId])
    binding().destroySender(this[kId])

    this.emit('disconnect')
  }

  /**
   * Get available buffer space.
   * @returns {number} Bytes available in buffer.
   */
  get bufferAvailable() {
    if (this[kClosed]) {
      return 0
    }
    const stats = binding().getStats(this[kId])
    const used = stats?.bytesBuffered ?? 0
    return this[kConfig].maxBufferSize - used
  }

  /**
   * Get used buffer space.
   * @returns {number} Bytes used in buffer.
   */
  get bufferUsed() {
    if (this[kClosed]) {
      return 0
    }
    const stats = binding().getStats(this[kId])
    return stats?.bytesBuffered ?? 0
  }

  /**
   * Get buffer usage ratio (0.0 - 1.0).
   * @returns {number} Buffer usage ratio.
   */
  #getBufferRatio() {
    if (this[kClosed]) {
      return 0
    }
    const stats = binding().getStats(this[kId])
    const used = stats?.bytesBuffered ?? 0
    const max = this[kConfig].maxBufferSize
    return used / max
  }

  /**
   * Check if buffer is under pressure (>= 75% full).
   * @returns {boolean} True if buffer usage is at or above the pressure threshold.
   */
  isBufferPressured() {
    return this.#getBufferRatio() >= BUFFER_PRESSURE_HIGH
  }

  /**
   * Check if buffer is critically full (>= 90% full).
   * @returns {boolean} True if buffer usage is at or above the critical threshold.
   */
  isBufferCritical() {
    return this.#getBufferRatio() >= BUFFER_PRESSURE_CRITICAL
  }

  /**
   * Get all buffer info in a single call (avoids multiple native calls).
   * Useful when checking multiple buffer properties at once.
   * @returns {{used: number, available: number, ratio: number, pressured: boolean, critical: boolean}}
   */
  getBufferInfo() {
    if (this[kClosed]) {
      return {
        __proto__: null,
        used: 0,
        available: 0,
        ratio: 0,
        pressured: false,
        critical: false,
      }
    }
    const stats = binding().getStats(this[kId])
    const used = stats?.bytesBuffered ?? 0
    const max = this[kConfig].maxBufferSize
    const ratio = used / max
    return {
      __proto__: null,
      used,
      available: max - used,
      ratio,
      pressured: ratio >= BUFFER_PRESSURE_HIGH,
      critical: ratio >= BUFFER_PRESSURE_CRITICAL,
    }
  }

  /**
   * Insert a complete row in one call (convenience method).
   * @param {string} tableName - Table name.
   * @param {object} data - Row data.
   * @param {object} [data.symbols] - Symbol (tag) columns.
   * @param {object} [data.fields] - Field columns (strings, booleans, integers, floats).
   * @param {object} [data.timestamps] - Timestamp columns (column name -> { value, unit? }).
   * @param {number|bigint} [data.timestamp] - Row timestamp.
   * @param {number} [data.timestampUnit=TimeUnit.Nanoseconds] - Timestamp unit.
   * @returns {Sender} this for chaining.
   */
  insertRow(tableName, data) {
    validateString(tableName, 'tableName')
    const d = { __proto__: null, ...data }
    validateObject(d, 'data')

    this.table(tableName)

    // Add symbols (tags).
    const symbols = d.symbols
    if (symbols) {
      const keys = ObjectKeys(symbols)
      for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i]
        const value = symbols[key]
        if (value !== undefined) {
          // Don't coerce - symbol() validates string type itself.
          this.symbol(key, value)
        }
      }
    }

    // Add fields.
    const fields = d.fields
    if (fields) {
      const keys = ObjectKeys(fields)
      for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i]
        const value = fields[key]
        if (value === undefined) {
          continue
        }

        const type = typeof value
        if (type === 'string') {
          this.stringColumn(key, value)
        } else if (type === 'boolean') {
          this.boolColumn(key, value)
        } else if (type === 'bigint') {
          this.intColumn(key, value)
        } else if (type === 'number') {
          // Determine if integer or float.
          if (NumberIsInteger(value)) {
            this.intColumn(key, value)
          } else {
            this.floatColumn(key, value)
          }
        } else {
          throw new ERR_INVALID_ARG_TYPE(
            `fields.${key}`,
            ['string', 'boolean', 'number', 'bigint'],
            value,
          )
        }
      }
    }

    // Add timestamp columns.
    const timestamps = d.timestamps
    if (timestamps) {
      const keys = ObjectKeys(timestamps)
      for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i]
        const spec = timestamps[key]
        if (spec === undefined) {
          continue
        }

        // Support both { value, unit } objects and plain values.
        // typeof null === 'object', so guard against null before
        // ObjectHasOwn which rejects null with a TypeError.
        if (
          typeof spec === 'object' &&
          spec !== null &&
          ObjectHasOwn(spec, 'value')
        ) {
          this.timestampColumn(
            key,
            spec.value,
            spec.unit ?? TimeUnit.Nanoseconds,
          )
        } else {
          // Plain number/bigint value.
          this.timestampColumn(key, spec, TimeUnit.Nanoseconds)
        }
      }
    }

    // Finalize row
    if (d.timestamp !== undefined) {
      this.at(d.timestamp, d.timestampUnit ?? TimeUnit.Nanoseconds)
    } else {
      this.atNow()
    }

    return this
  }

  /**
   * Insert multiple rows in one call (batch convenience method).
   * @param {string} tableName - Table name.
   * @param {object[]} rows - Array of row data objects.
   * @returns {Sender} this for chaining.
   */
  insertRows(tableName, rows) {
    validateString(tableName, 'tableName')
    if (!ArrayIsArray(rows)) {
      throw new ERR_INVALID_ARG_TYPE('rows', 'Array', rows)
    }

    for (let i = 0, len = rows.length; i < len; i++) {
      this.insertRow(tableName, rows[i])
    }

    return this
  }

  /**
   * Send data in a single fire-and-forget operation.
   * Creates a sender, connects, inserts rows, flushes, and closes.
   *
   * @param {object} options - Sender configuration options.
   * @param {string} tableName - Table name.
   * @param {object|object[]} rowsOrRow - Single row or array of rows.
   * @returns {Promise<void>}
   */
  static async sendOnce(options, tableName, rowsOrRow) {
    const sender = new Sender(options)
    try {
      await sender.connect()
      if (ArrayIsArray(rowsOrRow)) {
        sender.insertRows(tableName, rowsOrRow)
      } else {
        sender.insertRow(tableName, rowsOrRow)
      }
      await sender.flush()
    } finally {
      await sender.close()
    }
  }

  /**
   * Create a Sender from a connection string.
   * Supports formats: host:port, tcp://host:port, ilp://host:port
   * Query string params are mapped to options.
   *
   * @param {string} connectionString - Connection string.
   * @returns {Sender} New Sender instance.
   *
   * @example
   * const sender = Sender.fromConnectionString('localhost:9009');
   * const sender2 = Sender.fromConnectionString('ilp://db.example.com:9009?bufferSize=131072');
   */
  static fromConnectionString(connectionString) {
    validateString(connectionString, 'connectionString')

    if (connectionString.length === 0) {
      throw new ILPError(
        'Connection string cannot be empty',
        ErrorCodes.INVALID_ARGUMENT,
      )
    }

    let host = 'localhost'
    let port = 9009
    const options = { __proto__: null }

    // Try parsing as URL first (tcp://host:port or ilp://host:port)
    if (StringPrototypeIncludes(connectionString, '://')) {
      // Replace ilp:// or tcp:// with http:// for URL parsing
      const normalized = StringPrototypeReplace(
        StringPrototypeReplace(connectionString, ILP_SCHEME_REGEX, 'http://'),
        TCP_SCHEME_REGEX,
        'http://',
      )
      try {
        const url = new URLCtor(normalized)
        // Reject empty hostnames rather than silently defaulting
        if (!url.hostname || url.hostname.length === 0) {
          throw new ILPError(
            'Connection URL must include a hostname',
            ErrorCodes.INVALID_ARGUMENT,
          )
        }
        host = url.hostname
        port = url.port ? NumberParseInt(url.port, 10) : 9009

        // Validate port range.
        if (port < 1 || port > 65535) {
          throw new ILPError(
            `Invalid port ${port}: must be between 1 and 65535`,
            ErrorCodes.INVALID_ARGUMENT,
          )
        }

        // Parse query params as options - use primordial forEach to avoid prototype pollution
        URLSearchParamsPrototypeForEach(url.searchParams, (value, key) => {
          if (
            key === 'bufferSize' ||
            key === 'maxBufferSize' ||
            key === 'connectTimeout' ||
            key === 'sendTimeout' ||
            key === 'autoFlushRows' ||
            key === 'autoFlushInterval'
          ) {
            options[key] = NumberParseInt(value, 10)
          } else if (key === 'autoFlush') {
            options[key] = value === 'true' || value === '1'
          }
        })
      } catch (err) {
        throw new ILPError(
          `Invalid connection string URL: ${err.message}`,
          ErrorCodes.INVALID_ARGUMENT,
        )
      }
    } else {
      // Simple host:port format
      const colonIndex = StringPrototypeLastIndexOf(connectionString, ':')
      if (colonIndex > 0) {
        host = StringPrototypeSlice(connectionString, 0, colonIndex)
        const portStr = StringPrototypeSlice(connectionString, colonIndex + 1)
        const parsedPort = NumberParseInt(portStr, 10)
        if (
          !NumberIsFinite(parsedPort) ||
          parsedPort < 1 ||
          parsedPort > 65535
        ) {
          throw new ILPError(
            `Invalid port "${portStr}": must be a number between 1 and 65535`,
            ErrorCodes.INVALID_ARGUMENT,
          )
        }
        port = parsedPort
      } else {
        host = connectionString
      }
    }

    return new Sender({ __proto__: null, ...options, host, port })
  }

  #checkOpen() {
    if (this[kClosed]) {
      throw new ILPError(
        'Sender is closed. Create a new Sender instance to continue sending data.',
        ErrorCodes.CLOSED,
      )
    }
  }

  #emitEmptyRowWarning() {
    this.emit('warning', {
      __proto__: null,
      type: 'empty_row',
      message: `Row for table '${this[kCurrentTable]}' has no columns`,
      table: this[kCurrentTable],
    })
  }

  #createBufferPressureInfo(used, max, ratio) {
    return {
      __proto__: null,
      bytesUsed: used,
      bytesMax: max,
      percentUsed: MathFloor(ratio * 100),
    }
  }

  #checkTable() {
    if (this[kCurrentTable] === undefined) {
      throw new ILPError(
        'No table specified. Call .table("tableName") before adding columns.',
        ErrorCodes.NO_TABLE,
      )
    }
  }

  #maybeAutoFlush() {
    const { autoFlush, autoFlushRows } = this[kConfig]
    if (!autoFlush || !this[kConnected]) {
      return
    }

    // Prevent concurrent flushes - skip if flush already in progress
    // kRowsSinceFlush is incremented in at()/atNow() before calling this
    if (this[kRowsSinceFlush] >= autoFlushRows && !this[kFlushInProgress]) {
      this[kFlushInProgress] = true
      const flushPromise = this.flush()
        .catch(err => {
          // Emit error event for auto-flush failures (same as interval-based auto-flush)
          this.emit('error', err)
        })
        .finally(() => {
          this[kFlushInProgress] = false
          this[kFlushPromise] = undefined
        })
      this[kFlushPromise] = flushPromise
    }
  }

  #checkBufferPressure() {
    if (this[kClosed]) {
      return
    }
    // Only check every N rows for performance (avoid native call on every row)
    if (this[kRowsSinceFlush] % BUFFER_PRESSURE_CHECK_INTERVAL !== 0) {
      return
    }
    const stats = binding().getStats(this[kId])
    const used = stats?.bytesBuffered ?? 0
    const max = this[kConfig].maxBufferSize
    const ratio = used / max

    if (ratio >= BUFFER_PRESSURE_CRITICAL && this[kPressureEmitted] < 2) {
      this[kPressureEmitted] = 2
      this.emit(
        'bufferCritical',
        this.#createBufferPressureInfo(used, max, ratio),
      )
    } else if (ratio >= BUFFER_PRESSURE_HIGH && this[kPressureEmitted] < 1) {
      this[kPressureEmitted] = 1
      this.emit(
        'bufferPressure',
        this.#createBufferPressureInfo(used, max, ratio),
      )
    } else if (ratio < BUFFER_PRESSURE_HIGH && this[kPressureEmitted] > 0) {
      // Reset pressure state when buffer usage drops
      this[kPressureEmitted] = 0
    }
  }
}

ObjectDefineProperty(Sender.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'Sender',
})

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
class BulkRowBuilder {
  #sender
  #table
  #batchSize
  #rows = []
  #totalAdded = 0
  #totalFlushed = 0

  /**
   * Create a bulk row builder.
   * @param {Sender} sender - The sender to batch rows to.
   * @param {string} table - Table name for all rows.
   * @param {object} [options] - Builder options.
   * @param {number} [options.batchSize=1000] - Rows per batch before auto-flush.
   */
  constructor(sender, table, options) {
    if (!(sender instanceof Sender)) {
      throw new ERR_INVALID_ARG_TYPE('sender', 'Sender', sender)
    }
    validateString(table, 'table')
    const opts = { __proto__: null, ...options }
    this.#sender = sender
    this.#table = table
    this.#batchSize = opts.batchSize ?? 1000
    if (!NumberIsInteger(this.#batchSize) || this.#batchSize < 1) {
      throw new ERR_INVALID_ARG_VALUE(
        'options.batchSize',
        this.#batchSize,
        'must be a positive integer',
      )
    }
  }

  /**
   * Add a row to the batch.
   * @param {object} data - Row data (same format as insertRow).
   * @returns {BulkRowBuilder} this for chaining.
   */
  add(data) {
    ArrayPrototypePush(this.#rows, data)
    this.#totalAdded++
    if (this.#rows.length >= this.#batchSize) {
      this.#flushSync()
    }
    return this
  }

  /**
   * Add multiple rows to the batch.
   * @param {object[]} rows - Array of row data objects.
   * @returns {BulkRowBuilder} this for chaining.
   */
  addMany(rows) {
    if (!ArrayIsArray(rows)) {
      throw new ERR_INVALID_ARG_TYPE('rows', 'Array', rows)
    }
    for (let i = 0, len = rows.length; i < len; i++) {
      this.add(rows[i])
    }
    return this
  }

  /**
   * Flush pending rows synchronously (adds to sender buffer).
   */
  #flushSync() {
    const rowsLen = this.#rows.length
    if (rowsLen === 0) {
      return
    }
    this.#sender.insertRows(this.#table, this.#rows)
    this.#totalFlushed += rowsLen
    // Reuse existing array instead of allocating new one
    this.#rows.length = 0
  }

  /**
   * Finish building and flush all remaining rows.
   * @returns {Promise<{totalAdded: number, totalFlushed: number}>} Stats.
   */
  async finish() {
    this.#flushSync()
    await this.#sender.flush()
    return {
      __proto__: null,
      totalAdded: this.#totalAdded,
      totalFlushed: this.#totalFlushed,
    }
  }

  /**
   * Get current stats.
   * @returns {{pending: number, totalAdded: number, totalFlushed: number}}
   */
  get stats() {
    return {
      __proto__: null,
      pending: this.#rows.length,
      totalAdded: this.#totalAdded,
      totalFlushed: this.#totalFlushed,
    }
  }
}

ObjectDefineProperty(BulkRowBuilder.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'BulkRowBuilder',
})

module.exports = {
  __proto__: null,
  Sender,
  BulkRowBuilder,
  TimeUnit,
  ILPError,
  ErrorCodes,
}

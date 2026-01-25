/**
 * Update Config Binary Serializer
 *
 * Serializes update-config.json to binary format for embedding in node-smol binaries.
 * Validates all inputs at build time and throws errors for invalid data.
 */

import { readFileSync } from 'node:fs'

const UPDATE_CONFIG_MAGIC = 0x55_50_44_46 // "UPDF"
const UPDATE_CONFIG_VERSION = 1
const UPDATE_CONFIG_BINARY_SIZE = 1112

// Field size limits (from update_config.h)
const MAX_BINNAME_LEN = 127
const MAX_COMMAND_LEN = 254
const MAX_URL_LEN = 510
const MAX_TAG_LEN = 127
const MAX_SKIP_ENV_LEN = 63

/**
 * Validation error class.
 */
export class UpdateConfigValidationError extends Error {
  constructor(field, message) {
    super(`Invalid update config field '${field}': ${message}`)
    this.name = 'UpdateConfigValidationError'
    this.field = field
  }
}

/**
 * Validate and normalize a string field.
 */
function validateString(name, value, maxLength, defaultValue = '') {
  if (value === undefined || value === null) {
    return defaultValue
  }

  if (typeof value !== 'string') {
    throw new UpdateConfigValidationError(
      name,
      `must be a string, got ${typeof value}`,
    )
  }

  if (value.length > maxLength) {
    throw new UpdateConfigValidationError(
      name,
      `exceeds maximum length of ${maxLength} bytes (got ${value.length})`,
    )
  }

  return value
}

/**
 * Validate and normalize a boolean field.
 */
function validateBoolean(name, value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue
  }

  if (typeof value !== 'boolean') {
    throw new UpdateConfigValidationError(
      name,
      `must be a boolean, got ${typeof value}`,
    )
  }

  return value
}

/**
 * Validate and normalize a number field.
 */
function validateNumber(
  name,
  value,
  defaultValue,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (value === undefined || value === null) {
    return defaultValue
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UpdateConfigValidationError(
      name,
      `must be a finite number, got ${typeof value}`,
    )
  }

  if (value < min || value > max) {
    throw new UpdateConfigValidationError(
      name,
      `must be between ${min} and ${max}, got ${value}`,
    )
  }

  return value
}

/**
 * Validate and normalize prompt_default field.
 */
function validatePromptDefault(name, value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue
  }

  if (typeof value !== 'string') {
    throw new UpdateConfigValidationError(
      name,
      `must be a string, got ${typeof value}`,
    )
  }

  const normalized = value.toLowerCase()
  if (normalized === 'y' || normalized === 'yes') {
    return 'y'
  }
  if (normalized === 'n' || normalized === 'no') {
    return 'n'
  }

  throw new UpdateConfigValidationError(
    name,
    `must be 'y', 'yes', 'n', or 'no' (case-insensitive), got '${value}'`,
  )
}

/**
 * Serialize update config JSON to binary buffer with validation.
 * @param {object} config - Update config JSON object
 * @returns {Buffer} - Binary buffer (1112 bytes)
 * @throws {UpdateConfigValidationError} - If validation fails
 */
export function serializeUpdateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new UpdateConfigValidationError('config', 'must be an object')
  }

  // Validate and normalize all fields
  const prompt = validateBoolean('prompt', config.prompt, false)
  const promptDefault = validatePromptDefault(
    'prompt_default',
    config.prompt_default,
    'n',
  )
  const interval = validateNumber('interval', config.interval, 86_400_000, 0)
  const notifyInterval = validateNumber(
    'notify_interval',
    config.notify_interval,
    86_400_000,
    0,
  )

  const binname = validateString('binname', config.binname, MAX_BINNAME_LEN)
  const command = validateString(
    'command',
    config.command,
    MAX_COMMAND_LEN,
    'self-update',
  )
  const url = validateString('url', config.url, MAX_URL_LEN)
  const tag = validateString('tag', config.tag, MAX_TAG_LEN)
  const skipEnv = validateString('skip_env', config.skip_env, MAX_SKIP_ENV_LEN)

  // Validate URL format if provided
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    throw new UpdateConfigValidationError(
      'url',
      `must start with http:// or https://, got '${url}'`,
    )
  }

  // Create buffer
  const buffer = Buffer.alloc(UPDATE_CONFIG_BINARY_SIZE)
  let offset = 0

  // Header (8 bytes)
  buffer.writeUInt32LE(UPDATE_CONFIG_MAGIC, offset)
  offset += 4
  buffer.writeUInt16LE(UPDATE_CONFIG_VERSION, offset)
  offset += 2
  buffer.writeUInt8(prompt ? 1 : 0, offset++)
  buffer.writeUInt8(promptDefault.charCodeAt(0), offset++)

  // Numeric values (16 bytes)
  buffer.writeBigInt64LE(BigInt(interval), offset)
  offset += 8
  buffer.writeBigInt64LE(BigInt(notifyInterval), offset)
  offset += 8

  // Strings with inline length prefixes (1088 bytes)
  // binname: 1 byte length + 127 bytes data
  buffer.writeUInt8(binname.length, offset)
  buffer.write(binname, offset + 1, 127, 'utf8')
  offset += 128

  // command: 2 bytes length + 254 bytes data
  buffer.writeUInt16LE(command.length, offset)
  buffer.write(command, offset + 2, 254, 'utf8')
  offset += 256

  // url: 2 bytes length + 510 bytes data
  buffer.writeUInt16LE(url.length, offset)
  buffer.write(url, offset + 2, 510, 'utf8')
  offset += 512

  // tag: 1 byte length + 127 bytes data
  buffer.writeUInt8(tag.length, offset)
  buffer.write(tag, offset + 1, 127, 'utf8')
  offset += 128

  // skip_env: 1 byte length + 63 bytes data
  buffer.writeUInt8(skipEnv.length, offset)
  buffer.write(skipEnv, offset + 1, 63, 'utf8')
  offset += 64

  return buffer
}

/**
 * Parse update config JSON file and serialize to binary.
 * @param {string} filePath - Path to update-config.json file
 * @returns {Buffer} - Binary buffer (1112 bytes)
 * @throws {UpdateConfigValidationError} - If validation fails
 * @throws {Error} - If file read or JSON parsing fails
 */
export function parseConfigFile(filePath) {
  let fileContent
  try {
    fileContent = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(
      `Failed to read update config file '${filePath}': ${error.message}`,
    )
  }

  let config
  try {
    config = JSON.parse(fileContent)
  } catch (error) {
    throw new Error(
      `Failed to parse update config JSON in '${filePath}': ${error.message}`,
    )
  }

  return serializeUpdateConfig(config)
}

/**
 * Parse update config JSON string and serialize to binary.
 * @param {string} jsonString - JSON string
 * @returns {Buffer} - Binary buffer (1112 bytes)
 * @throws {UpdateConfigValidationError} - If validation fails
 * @throws {SyntaxError} - If JSON parsing fails
 */
export function parseAndSerialize(jsonString) {
  let config
  try {
    config = JSON.parse(jsonString)
  } catch (error) {
    throw new Error(`Failed to parse update config JSON: ${error.message}`)
  }

  return serializeUpdateConfig(config)
}

/**
 * Smol Config Binary Serializer
 *
 * Serializes smol config (update config + fakeArgvEnv) to binary format for embedding in node-smol binaries.
 * Validates all inputs at build time and throws errors for invalid data.
 */

import { readFileSync } from 'node:fs'

// "SMFG" (Smol conFiG)
const SMOL_CONFIG_MAGIC = 0x53_4d_46_47
const SMOL_CONFIG_VERSION = 2
const SMOL_CONFIG_BINARY_SIZE = 1200

// Field size limits (from smol_config.h)
const MAX_BINNAME_LEN = 127
const MAX_COMMAND_LEN = 254
const MAX_URL_LEN = 510
const MAX_TAG_LEN = 127
const MAX_SKIP_ENV_LEN = 63
const MAX_FAKE_ARGV_ENV_LEN = 63
const MAX_NODE_VERSION_LEN = 15

/**
 * Validation error class.
 */
export class SmolConfigValidationError extends Error {
  constructor(field, message) {
    super(`Invalid smol config field '${field}': ${message}`)
    this.name = 'SmolConfigValidationError'
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
    throw new SmolConfigValidationError(
      name,
      `must be a string, got ${typeof value}`,
    )
  }

  if (value.length > maxLength) {
    throw new SmolConfigValidationError(
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
    throw new SmolConfigValidationError(
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
    throw new SmolConfigValidationError(
      name,
      `must be a finite number, got ${typeof value}`,
    )
  }

  if (value < min || value > max) {
    throw new SmolConfigValidationError(
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
    throw new SmolConfigValidationError(
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

  throw new SmolConfigValidationError(
    name,
    `must be 'y', 'yes', 'n', or 'no' (case-insensitive), got '${value}'`,
  )
}

/**
 * Serialize smol config JSON to binary buffer with validation.
 * @param {object} config - Smol config JSON object
 * @returns {Buffer} - Binary buffer (1200 bytes)
 * @throws {SmolConfigValidationError} - If validation fails
 */
export function serializeSmolConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new SmolConfigValidationError('config', 'must be an object')
  }

  // Extract update config and fakeArgvEnv
  const updateConfig = config.update || {}
  const fakeArgvEnv = validateString(
    'fakeArgvEnv',
    config.fakeArgvEnv,
    MAX_FAKE_ARGV_ENV_LEN,
    'SMOL_FAKE_ARGV',
  )

  // Validate and normalize update config fields (use camelCase)
  const prompt = validateBoolean('prompt', updateConfig.prompt, false)
  const promptDefault = validatePromptDefault(
    'promptDefault',
    updateConfig.promptDefault,
    'n',
  )
  const interval = validateNumber(
    'interval',
    updateConfig.interval,
    86_400_000,
    0,
  )
  const notifyInterval = validateNumber(
    'notifyInterval',
    updateConfig.notifyInterval,
    86_400_000,
    0,
  )

  const binname = validateString(
    'binname',
    updateConfig.binname,
    MAX_BINNAME_LEN,
  )
  const command = validateString(
    'command',
    updateConfig.command,
    MAX_COMMAND_LEN,
    'self-update',
  )
  const url = validateString('url', updateConfig.url, MAX_URL_LEN)
  const tag = validateString('tag', updateConfig.tag, MAX_TAG_LEN)
  const skipEnv = validateString(
    'skipEnv',
    updateConfig.skipEnv,
    MAX_SKIP_ENV_LEN,
  )
  const nodeVersion = validateString(
    'nodeVersion',
    updateConfig.nodeVersion,
    MAX_NODE_VERSION_LEN,
  )

  // Validate URL format if provided
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    throw new SmolConfigValidationError(
      'url',
      `must start with http:// or https://, got '${url}'`,
    )
  }

  // Create buffer
  const buffer = Buffer.alloc(SMOL_CONFIG_BINARY_SIZE)
  let offset = 0

  // Header (8 bytes)
  buffer.writeUInt32LE(SMOL_CONFIG_MAGIC, offset)
  offset += 4
  buffer.writeUInt16LE(SMOL_CONFIG_VERSION, offset)
  offset += 2
  buffer.writeUInt8(prompt ? 1 : 0, offset++)
  buffer.writeUInt8(promptDefault.charCodeAt(0), offset++)

  // Numeric values (16 bytes)
  buffer.writeBigInt64LE(BigInt(interval), offset)
  offset += 8
  buffer.writeBigInt64LE(BigInt(notifyInterval), offset)
  offset += 8

  // Strings with inline length prefixes (1168 bytes)
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

  // skipEnv: 1 byte length + 63 bytes data
  buffer.writeUInt8(skipEnv.length, offset)
  buffer.write(skipEnv, offset + 1, 63, 'utf8')
  offset += 64

  // fakeArgvEnv: 1 byte length + 63 bytes data
  buffer.writeUInt8(fakeArgvEnv.length, offset)
  buffer.write(fakeArgvEnv, offset + 1, 63, 'utf8')
  offset += 64

  // nodeVersion: 1 byte length + 15 bytes data
  buffer.writeUInt8(nodeVersion.length, offset)
  buffer.write(nodeVersion, offset + 1, 15, 'utf8')
  offset += 16

  return buffer
}

/**
 * Parse smol config JSON file and serialize to binary.
 * @param {string} filePath - Path to smol-config.json file
 * @returns {Buffer} - Binary buffer (1200 bytes)
 * @throws {SmolConfigValidationError} - If validation fails
 * @throws {Error} - If file read or JSON parsing fails
 */
export function parseConfigFile(filePath) {
  let fileContent
  try {
    fileContent = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(
      `Failed to read smol config file '${filePath}': ${error.message}`,
    )
  }

  let config
  try {
    config = JSON.parse(fileContent)
  } catch (error) {
    throw new Error(
      `Failed to parse smol config JSON in '${filePath}': ${error.message}`,
    )
  }

  return serializeUpdateConfig(config)
}

/**
 * Parse smol config JSON string and serialize to binary.
 * @param {string} jsonString - JSON string
 * @returns {Buffer} - Binary buffer (1200 bytes)
 * @throws {SmolConfigValidationError} - If validation fails
 * @throws {SyntaxError} - If JSON parsing fails
 */
export function parseAndSerialize(jsonString) {
  let config
  try {
    config = JSON.parse(jsonString)
  } catch (error) {
    throw new Error(`Failed to parse smol config JSON: ${error.message}`)
  }

  return serializeUpdateConfig(config)
}

/**
 * Backward compatibility wrapper for serializeUpdateConfig.
 * Accepts flat config (old format) and wraps it in smol.update structure.
 * Also converts snake_case to camelCase for backward compatibility.
 */
export function serializeUpdateConfig(config) {
  // Validate config is an object.
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new SmolConfigValidationError('config', 'must be an object')
  }

  // If config already has 'update' key, pass through to serializeSmolConfig.
  if (config.update) {
    return serializeSmolConfig(config)
  }

  // Wrap flat config in 'update' key
  return serializeSmolConfig({ update: config })
}

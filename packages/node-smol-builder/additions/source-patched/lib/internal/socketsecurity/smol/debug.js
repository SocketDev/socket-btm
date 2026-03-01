'use strict'

const {
  ProcessEnv,
  ProcessStderrWrite,
} = require('internal/socketsecurity/safe-references')

// Use primordials for protection against prototype pollution
const {
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypeSlice,
  JSONStringify,
  Number: NumberConstructor,
  NumberPrototypeToString,
  ObjectFreeze,
  String: StringConstructor,
  StringPrototypeIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeTrim,
  hardenRegExp,
} = primordials

/**
 * Debug logging utilities for Socket Security Smol runtime
 *
 * Compatible with npm's debug package - supports namespace filtering and wildcards.
 *
 * Usage:
 *   const { createDebug, isDebugEnabled } = require('internal/socketsecurity/smol/debug')
 *   const debug = createDebug('smol:vfs')
 *   debug('Initialized with %d entries', 42)
 *
 *   if (isDebugEnabled('smol:vfs:verbose')) {
 *     // expensive debug operation
 *   }
 *
 * Environment:
 *   DEBUG=smol:vfs          -> enables "smol:vfs" namespace
 *   DEBUG=smol:*            -> enables all "smol:" namespaces
 *   DEBUG=*                 -> enables all namespaces
 *   DEBUG=smol:vfs,binject  -> enables "smol:vfs" and "binject"
 *   DEBUG=*,-smol:vfs       -> enables all except "smol:vfs"
 */

// Hardened regex constants (protected from prototype pollution)
const FORMAT_SPECIFIER_REGEX = hardenRegExp(/%[sdo]/g)

// Cache parsed DEBUG patterns for performance
let cachedPatterns
let lastDebugEnv

/**
 * Parse DEBUG environment variable into patterns
 */
function parseDebugPatterns() {
  const debugEnv = ProcessEnv.DEBUG

  // Return cached if unchanged
  if (debugEnv === lastDebugEnv && cachedPatterns) {
    return cachedPatterns
  }

  lastDebugEnv = debugEnv

  if (
    !debugEnv ||
    debugEnv === '' ||
    debugEnv === '0' ||
    debugEnv === 'false'
  ) {
    cachedPatterns = []
    return cachedPatterns
  }

  // Backward compat: treat "1", "true", "yes" as enable-all
  if (debugEnv === '1' || debugEnv === 'true' || debugEnv === 'yes') {
    cachedPatterns = [{ pattern: '*', negated: false }]
    return cachedPatterns
  }

  // Parse comma-separated patterns
  cachedPatterns = ArrayPrototypeMap(StringPrototypeSplit(debugEnv, ','), p => {
    const trimmed = StringPrototypeTrim(p)
    if (StringPrototypeStartsWith(trimmed, '-')) {
      return { pattern: StringPrototypeSlice(trimmed, 1), negated: true }
    }
    return { pattern: trimmed, negated: false }
  })

  return cachedPatterns
}

/**
 * Check if pattern matches namespace
 * Supports wildcards: "smol:*" matches "smol:vfs", "smol:binject", etc.
 */
function matchesPattern(pattern, ns) {
  const starIndex = StringPrototypeIndexOf(pattern, '*')

  if (starIndex === -1) {
    // Exact match
    return pattern === ns
  }

  // Wildcard match: compare prefix before '*'
  const prefix = StringPrototypeSlice(pattern, 0, starIndex)
  return StringPrototypeStartsWith(ns, prefix)
}

/**
 * Check if namespace is enabled by DEBUG environment variable
 */
function isDebugEnabled(ns) {
  const patterns = parseDebugPatterns()

  if (patterns.length === 0) {
    return false
  }

  let enabled = false

  // Process patterns in order (last match wins)
  for (let i = 0, { length } = patterns; i < length; i += 1) {
    const patternObj = patterns[i]
    if (matchesPattern(patternObj.pattern, ns)) {
      enabled = !patternObj.negated
    }
  }

  return enabled
}

/**
 * Create a debug logger for a specific namespace
 * Returns a function that logs messages when the namespace is enabled
 */
function createDebug(ns) {
  const enabled = isDebugEnabled(ns)

  // Return no-op if disabled (avoids string interpolation cost)
  if (!enabled) {
    return () => {}
  }

  // Return logger that writes to stderr with namespace prefix
  return (msg, ...args) => {
    // Simple string interpolation (supports %s, %d, %o patterns)
    let formatted = msg
    let argIndex = 0

    formatted = StringPrototypeReplace(
      formatted,
      FORMAT_SPECIFIER_REGEX,
      match => {
        if (argIndex >= args.length) {
          return match
        }
        const arg = args[argIndex++]

        if (match === '%s') {
          return StringConstructor(arg)
        }
        if (match === '%d') {
          return NumberPrototypeToString(NumberConstructor(arg))
        }
        if (match === '%o') {
          try {
            return JSONStringify(arg)
          } catch {
            return StringConstructor(arg)
          }
        }
        return match
      },
    )

    // Append remaining args
    if (argIndex < args.length) {
      formatted += ` ${ArrayPrototypeJoin(
        ArrayPrototypeSlice(args, argIndex),
        ' ',
      )}`
    }

    // Write to stderr with namespace prefix
    ProcessStderrWrite(`[${ns}] ${formatted}\n`)
  }
}

module.exports = ObjectFreeze({
  createDebug,
  isDebugEnabled,
})

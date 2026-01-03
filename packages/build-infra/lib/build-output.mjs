/**
 * Build Output Utilities
 *
 * Provides consistent, pretty logging for build processes.
 */

import loggerPkg from '@socketsecurity/lib/logger'

const logger = loggerPkg.getDefaultLogger()

/**
 * Print error message with optional description and details.
 *
 * @param {string} message - Error title/header.
 * @param {string|Error|null} [descriptionOrError] - Error description or Error object.
 * @param {string[]} [details] - Additional error details lines.
 */
export function printError(message, descriptionOrError = null, details = null) {
  logger.error(message)

  // Handle Error object (backward compatibility).
  if (descriptionOrError instanceof Error) {
    logger.error(descriptionOrError.message || 'Unknown error')
    if (descriptionOrError.stack) {
      logger.error(descriptionOrError.stack)
    }
    return
  }

  // Handle string description.
  if (descriptionOrError) {
    logger.error(descriptionOrError)
  }

  // Handle details array.
  if (details && Array.isArray(details)) {
    for (const line of details) {
      logger.error(line)
    }
  }
}

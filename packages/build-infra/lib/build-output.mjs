/**
 * Build Output Utilities
 *
 * Provides consistent, pretty logging for build processes.
 */

import loggerPkg from '@socketsecurity/lib/logger'

const logger = loggerPkg.getDefaultLogger()

/**
 * Print error message with stack trace.
 * Helper that adds error.message and error.stack automatically.
 */
export function printError(message, error = null) {
  logger.error(message)
  if (error) {
    logger.error(error.message)
    if (error.stack) {
      logger.error(error.stack)
    }
  }
}

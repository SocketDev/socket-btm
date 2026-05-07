/**
 * Build output utilities for formatted console output.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Print an error message to stderr.
 * @param {string} message - Error message to print.
 */
export function printError(message) {
  logger.fail(message)
}

/**
 * Print a success message to stdout.
 * @param {string} message - Success message to print.
 */
export function printSuccess(message) {
  logger.success(message)
}

/**
 * Print an info message to stdout.
 * @param {string} message - Info message to print.
 */
export function printInfo(message) {
  logger.info(message)
}

/**
 * Print a warning message to stdout.
 * @param {string} message - Warning message to print.
 */
export function printWarning(message) {
  logger.warn(message)
}

/**
 * Build output utilities for formatted console output.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

/**
 * Print an error message to stderr, with the causing error's detail when one
 * is provided.
 */
export function printError(message: string, error?: unknown): void {
  logger.fail(message)
  if (error !== undefined) {
    logger.fail(errorMessage(error))
  }
}

/**
 * Print an info message to stdout.
 */
export function printInfo(message: string): void {
  logger.info(message)
}

/**
 * Print a success message to stdout.
 */
export function printSuccess(message: string): void {
  logger.success(message)
}

/**
 * Print a warning message to stdout.
 */
export function printWarning(message: string): void {
  logger.warn(message)
}

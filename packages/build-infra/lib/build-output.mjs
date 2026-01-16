/**
 * Build output utilities for formatted console output
 */

/**
 * Print an error message to stderr
 * @param {string} message - Error message to print
 */
export function printError(message) {
  console.error(`\x1b[91m✖\x1b[39m ${message}`)
}

/**
 * Print a success message to stdout
 * @param {string} message - Success message to print
 */
export function printSuccess(message) {
  console.log(`\x1b[92m✔\x1b[39m ${message}`)
}

/**
 * Print an info message to stdout
 * @param {string} message - Info message to print
 */
export function printInfo(message) {
  console.log(`\x1b[94mℹ\x1b[39m ${message}`)
}

/**
 * Print a warning message to stdout
 * @param {string} message - Warning message to print
 */
export function printWarning(message) {
  console.log(`\x1b[93m⚠\x1b[39m ${message}`)
}

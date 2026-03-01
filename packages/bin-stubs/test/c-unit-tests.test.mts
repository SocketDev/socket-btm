/**
 * C Unit Tests Runner
 *
 * This Vitest test file builds and runs C unit tests from the test/ directory.
 * The C tests use the minunit-style test framework from bin-infra/test.h.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testDir = __dirname

describe('C Unit Tests', () => {
  it('should build and run update_config_test', () => {
    // Build the C tests using the Makefile
    const _buildResult = execSync('make -s clean && make -s', {
      cwd: testDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Verify the binary was built
    const binaryPath = path.join(testDir, 'out', 'update_config_test')
    expect(existsSync(binaryPath)).toBe(true)

    // Run the test binary and capture output
    const testOutput = execSync(binaryPath, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Verify all tests passed (output should contain "Passed: N" with no failures)
    expect(testOutput).toMatch(/Passed:\s+\d+/)
    expect(testOutput).not.toMatch(/Failed:\s+[1-9]/)
  })
})

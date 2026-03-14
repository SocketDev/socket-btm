/**
 * C Unit Tests Runner
 *
 * This Vitest test file builds and runs C unit tests from the test/ directory.
 * The C tests use the minunit-style test framework from bin-infra/test.h.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testDir = __dirname

describe('c Unit Tests', () => {
  it('should build and run update_config_test', async () => {
    // Build the C tests using the Makefile
    await spawn('make', ['-s', 'clean'], {
      cwd: testDir,
      stdio: 'pipe',
    })
    await spawn('make', ['-s'], {
      cwd: testDir,
      stdio: 'pipe',
    })

    // Verify the binary was built
    const binaryPath = path.join(testDir, 'out', 'update_config_test')
    expect(existsSync(binaryPath)).toBeTruthy()

    // Run the test binary and capture output
    const testResult = await spawn(binaryPath, [], {
      cwd: testDir,
      stdio: 'pipe',
    })
    const testOutput = testResult.stdout || ''

    // Verify all tests passed (output should contain "Passed: N" with no failures)
    expect(testOutput).toMatch(/Passed:\s+\d+/)
    expect(testOutput).not.toMatch(/Failed:\s+[1-9]/)
  })
})

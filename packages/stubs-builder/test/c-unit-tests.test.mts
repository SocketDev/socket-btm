/**
 * C Unit Tests Runner
 *
 * This Vitest test file builds and runs C unit tests from the test/ directory.
 * The C tests use the minunit-style test framework from bin-infra/test.h.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testDir = __dirname

describe('c Unit Tests', () => {
  it('should build and run update_config_test', async () => {
    const buildMode = getBuildMode()
    const platformArch = await getCurrentPlatformArch()

    // Build the C tests using the Makefile. Pass the same BUILD_MODE and
    // PLATFORM_ARCH the workspace uses so the Makefile output lands at
    // test/build/<mode>/<platform-arch>/out/ (covered by **/build/ gitignore).
    const makeEnv = [`BUILD_MODE=${buildMode}`, `PLATFORM_ARCH=${platformArch}`]
    await spawn('make', ['-s', 'clean', ...makeEnv], {
      cwd: testDir,
      stdio: 'pipe',
    })
    await spawn('make', ['-s', ...makeEnv], {
      cwd: testDir,
      stdio: 'pipe',
    })

    // Verify the binary was built
    const binaryPath = path.join(
      testDir,
      'build',
      buildMode,
      platformArch,
      'out',
      'update_config_test',
    )
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

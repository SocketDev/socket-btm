/**
 * Minimal test to diagnose hanging issue.
 * Trying without sentinelFuse and machoSegmentName.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { makeExecutable } from 'build-infra/lib/build-helpers'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { runBinject } from '../helpers/binject.mts'
import { getLatestFinalBinary } from '../paths.mts'

const logger = getDefaultLogger()

const finalBinaryPath = getLatestFinalBinary()
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath)
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-sea-minimal-test')

describe.skipIf(skipTests)('test with actual binject', () => {
  beforeAll(async () => {
    logger.log('beforeAll: creating temp dir')
    await fs.mkdir(testTmpDir, { recursive: true })
    logger.log('beforeAll: done')
  })

  afterAll(async () => {
    logger.log('afterAll: SKIPPING cleanup to test binary manually')
    // await fs.rm(testTmpDir, { recursive: true, force: true })
  })

  it('should create and inject a simple SEA app', async () => {
    const testDir = path.join(testTmpDir, 'hello-sea')
    await fs.mkdir(testDir, { recursive: true })

    // Create simple app
    const appJs = path.join(testDir, 'app.js')
    await fs.writeFile(appJs, `console.log('Hello SEA');`)

    // Create SEA config
    const seaConfig = path.join(testDir, 'sea-config.json')
    await fs.writeFile(
      seaConfig,
      JSON.stringify({
        disableExperimentalSEAWarning: true,
        main: 'app.js',
        output: 'app.blob',
      }),
    )

    // Copy binary
    const seaBinary = path.join(testDir, 'app')
    await fs.copyFile(finalBinaryPath, seaBinary)
    await makeExecutable(seaBinary)

    logger.log(
      'About to call runBinject WITHOUT sentinelFuse/machoSegmentName…',
    )
    // Inject SEA blob - NO sentinelFuse or machoSegmentName
    const result = await runBinject(
      seaBinary,
      'NODE_SEA_BLOB',
      'sea-config.json',
      {
        testDir,
      },
    )
    logger.log('runBinject completed with exit code:', result.code)

    expect(result.code).toBe(0)

    // Run binary
    logger.log('About to execute binary…')
    const execResult = await spawn(seaBinary, [], { cwd: testDir })
    logger.log('Binary executed with exit code:', execResult.code)

    expect(execResult.code).toBe(0)
    expect(execResult.stdout).toContain('Hello SEA')

    logger.log('Test completed successfully!')
  })
})

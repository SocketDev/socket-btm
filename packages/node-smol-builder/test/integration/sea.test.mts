/**
 * Minimal test to diagnose hanging issue.
 * Trying without sentinelFuse and machoSegmentName.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { spawn } from '@socketsecurity/lib/spawn'

import { runBinject } from '../helpers/binject.mjs'
import { getLatestFinalBinary } from '../paths.mjs'

const finalBinaryPath = getLatestFinalBinary()
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath)
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-sea-minimal-test')

describe.skipIf(skipTests)('Test with actual binject', () => {
  beforeAll(async () => {
    console.log('beforeAll: creating temp dir')
    await fs.mkdir(testTmpDir, { recursive: true })
    console.log('beforeAll: done')
  })

  afterAll(async () => {
    console.log('afterAll: SKIPPING cleanup to test binary manually')
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
        main: 'app.js',
        output: 'app.blob',
        disableExperimentalSEAWarning: true,
      }),
    )

    // Copy binary
    const seaBinary = path.join(testDir, 'app')
    await fs.copyFile(finalBinaryPath, seaBinary)
    await fs.chmod(seaBinary, 0o755)

    console.log(
      'About to call runBinject WITHOUT sentinelFuse/machoSegmentName...',
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
    console.log('runBinject completed with exit code:', result.code)

    expect(result.code).toBe(0)

    // Run binary
    console.log('About to execute binary...')
    const execResult = await spawn(seaBinary, [], { cwd: testDir })
    console.log('Binary executed with exit code:', execResult.code)

    expect(execResult.code).toBe(0)
    expect(execResult.stdout).toContain('Hello SEA')

    console.log('Test completed successfully!')
  })
})

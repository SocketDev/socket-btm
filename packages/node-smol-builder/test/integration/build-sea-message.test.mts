/**
 * @fileoverview Tests for --build-sea flag behavior.
 *
 * The smol binary accepts --build-sea as a recognized flag (exits 0).
 * Actual SEA blob generation uses --experimental-sea-config (Node.js upstream).
 *
 * Note: Requires a built smol binary at build/{dev,prod}/out/Final/node/.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mts'

const finalBinaryPath = getLatestFinalBinary()
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath)

describe.skipIf(skipTests)('--build-sea flag', () => {
  it('should accept --build-sea without error', async () => {
    // --build-sea is a recognized flag (exits 0 without generating a blob).
    const result = await spawn(finalBinaryPath, ['--build-sea', '/dev/null'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    })
    expect(result.code).toBe(0)
  })

  it('should generate blob with --experimental-sea-config', async () => {
    const testDir = path.join(os.tmpdir(), `sea-blob-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    const mainJs = path.join(testDir, 'main.js')
    const blobFile = path.join(testDir, 'out.blob')
    const configFile = path.join(testDir, 'sea-config.json')

    await fs.writeFile(mainJs, 'console.log("hello SEA")')
    await fs.writeFile(
      configFile,
      JSON.stringify({ main: 'main.js', output: 'out.blob' }),
    )

    const result = await spawn(
      finalBinaryPath,
      ['--experimental-sea-config', configFile],
      { cwd: testDir, timeout: 30_000 },
    )

    expect(result.code).toBe(0)
    expect(existsSync(blobFile)).toBeTruthy()

    const stat = await fs.stat(blobFile)
    expect(stat.size).toBeGreaterThan(0)

    await fs.rm(testDir, { recursive: true, force: true })
  })
})

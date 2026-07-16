/**
 * @file Round-trip extraction error-handling tests for binject. Split out
 *   of roundtrip-extraction.test.mts to keep both files under the
 *   file-size soft cap; shares the same BINJECT/testDir setup.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getBinjectPath } from './helpers/paths.mts'
import { execCommand } from './helpers/exec-command.mts'

const logger = getDefaultLogger()

const BINJECT = getBinjectPath()

let testDir: string
let binjectExists = false

beforeAll(async () => {
  binjectExists = existsSync(BINJECT)
  if (!binjectExists) {
    logger.warn(`binject not found at ${BINJECT}`)
    logger.warn('   Run: pnpm build in packages/binject')
    return
  }

  testDir = path.join(os.tmpdir(), `binject-roundtrip-error-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binjectExists)(
  'round-trip extraction (error handling)',
  () => {
    describe('error handling in extraction', () => {
      it('should fail gracefully when extracting non-existent SEA blob', async () => {
        // Binary without SEA blob
        const binaryWithoutSea = path.join(testDir, 'no_sea_binary')
        await fs.copyFile(BINJECT, binaryWithoutSea)

        const extractedSea = path.join(testDir, 'should_not_exist.blob')
        const extractResult = await execCommand(BINJECT, [
          'extract',
          '-e',
          binaryWithoutSea,
          '-o',
          extractedSea,
          '--sea',
        ])

        // Should fail with non-zero exit code
        expect(extractResult.code).not.toBe(0)
        expect(extractResult.stderr).toBeTruthy()
        expect(extractResult.stderr.toLowerCase()).toMatch(
          /not found|missing|no sea|cannot/,
        )

        // Output file should not be created
        expect(existsSync(extractedSea)).toBeFalsy()
      }, 30_000)

      it('should fail gracefully when extracting non-existent VFS', async () => {
        const binaryWithoutVfs = path.join(testDir, 'no_vfs_binary')
        await fs.copyFile(BINJECT, binaryWithoutVfs)

        const extractedVfs = path.join(testDir, 'should_not_exist.vfs')
        const extractResult = await execCommand(BINJECT, [
          'extract',
          '-e',
          binaryWithoutVfs,
          '-o',
          extractedVfs,
          '--vfs',
        ])

        expect(extractResult.code).not.toBe(0)
        expect(extractResult.stderr).toBeTruthy()
        expect(extractResult.stderr.toLowerCase()).toMatch(
          /not found|missing|no vfs|cannot/,
        )
        expect(existsSync(extractedVfs)).toBeFalsy()
      }, 30_000)
    })
  },
)

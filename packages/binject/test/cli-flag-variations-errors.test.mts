/**
 * @file CLI flag error-handling tests for binject. Split out of
 *   cli-flag-variations.test.mts to keep both files under the file-size
 *   soft cap; shares the same BINJECT/testDir setup.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'

import { getBinjectPath } from './helpers/paths.mts'
import { execCommand } from './helpers/exec-command.mts'

const BINJECT = getBinjectPath()

let testDir: string
const binjectExists = existsSync(BINJECT)

beforeAll(async () => {
  if (!binjectExists) {
    return
  }

  testDir = path.join(os.tmpdir(), `binject-flags-error-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binjectExists)('cLI flag variations (error handling)', () => {
  describe('error handling for flag variations', () => {
    it('should reject inject without -e/--executable', async () => {
      const seaBlob = path.join(testDir, 'error-test.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const output = path.join(testDir, 'error-output')

      const result = await execCommand(BINJECT, [
        'inject',
        '-o',
        output,
        '--sea',
        seaBlob,
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('executable')
    })

    it('should reject inject without -o/--output', async () => {
      const input = path.join(testDir, 'error-input')
      await fs.copyFile(BINJECT, input)

      const seaBlob = path.join(testDir, 'error-test2.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        input,
        '--sea',
        seaBlob,
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('output')
    })

    it('should reject extract without -e/--executable', async () => {
      const output = path.join(testDir, 'extract-error-output')

      const result = await execCommand(BINJECT, [
        'extract',
        '-o',
        output,
        '--sea',
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('executable')
    })

    it('should reject extract without -o/--output', async () => {
      const binary = path.join(testDir, 'extract-error-binary')
      await fs.copyFile(BINJECT, binary)

      const result = await execCommand(BINJECT, [
        'extract',
        '-e',
        binary,
        '--sea',
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('output')
    })

    it('should reject verify without -e/--executable', async () => {
      const result = await execCommand(BINJECT, ['verify', '--sea'])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('executable')
    })
  })
})

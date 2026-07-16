import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
/**
 * CLI Integration Tests for binject — argument validation and injection
 * commands. Covers argument Validation, single/batch Resource Injection,
 * output Parameter, auto-Overwrite Behavior, list/extract/verify commands,
 * and invalid Flag Combinations. Split from cli-integration.test.mts.
 */

import { constants as FS_CONSTANTS, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { makeExecutable } from 'build-infra/lib/build-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { MAX_NODE_BINARY_SIZE } from './helpers/constants.mts'
import { getBinjectPath } from './helpers/paths.mts'
import { execCommand, findNodeBinary } from './cli-integration.test.mts'

const logger = getDefaultLogger()

const BINJECT = getBinjectPath()

let testDir: string
let binjectExists = false
let nodeBinary: string | undefined = undefined

async function createTestBinary(name: string) {
  const filePath = path.join(testDir, name)
  if (!nodeBinary) {
    throw new Error('nodeBinary not set')
  }
  await fs.copyFile(nodeBinary, filePath)
  await makeExecutable(filePath)
  return filePath
}

async function createTestResource(name: string) {
  const filePath = path.join(testDir, name)
  await fs.writeFile(filePath, 'Test resource data\n')
  return filePath
}

describe('binject CLI commands', () => {
  beforeAll(async () => {
    logger.log('Checking for BINJECT at:', BINJECT)
    try {
      // oxlint-disable-next-line socket/prefer-exists-sync -- many access(X_OK) and access(F_OK) calls check executable permission / output-file readiness inside Promise.all races; existsSync (sync, no permission check) is not a substitute.
      await fs.access(BINJECT, FS_CONSTANTS.X_OK)
      // oxlint-disable-next-line socket/prefer-exists-sync -- many access(X_OK) and access(F_OK) calls check executable permission / output-file readiness inside Promise.all races; existsSync (sync, no permission check) is not a substitute.
      const stats = await fs.stat(BINJECT)
      logger.log(
        'BINJECT found! Size:',
        stats.size,
        'Mode:',
        stats.mode.toString(8),
      )
      binjectExists = true
    } catch (e) {
      const code =
        e instanceof Error && 'code' in e
          ? (e as NodeJS.ErrnoException).code
          : undefined
      logger.fail('BINJECT not accessible:', code, errorMessage(e))
      binjectExists = false
      return
    }

    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-cmd-test-'))

    const foundBinary = await findNodeBinary()

    if (!foundBinary) {
      binjectExists = false
      return
    }

    // oxlint-disable-next-line socket/prefer-exists-sync -- many access(X_OK) and access(F_OK) calls check executable permission / output-file readiness inside Promise.all races; existsSync (sync, no permission check) is not a substitute.
    const stats = await fs.stat(foundBinary)
    if (stats.size > MAX_NODE_BINARY_SIZE) {
      logger.warn(
        `Node binary too large for binject tests: ${(stats.size / 1024 / 1024).toFixed(2)}MB > ${MAX_NODE_BINARY_SIZE / 1024 / 1024}MB`,
      )
      logger.warn(
        'Skipping tests - node-smol not available and system Node.js too large',
      )
      binjectExists = false
      return
    }

    const ext = os.platform() === 'win32' ? '.exe' : ''
    nodeBinary = path.join(testDir, `node-copy${ext}`)
    await fs.copyFile(foundBinary, nodeBinary)
    await makeExecutable(nodeBinary)
    logger.log('Copied node binary to tmpdir:', nodeBinary)
  })

  beforeEach(ctx => {
    if (!binjectExists) {
      ctx.skip()
    }
  })

  afterAll(async () => {
    if (testDir) {
      await safeDelete(testDir)
    }
  })

  describe('argument Validation', () => {
    it('inject without args should show error', async () => {
      const result = await execCommand(BINJECT, ['inject'])
      expect(result.output).toContain('requires')
    })

    it('inject without --executable should show error', async () => {
      const result = await execCommand(BINJECT, [
        'inject',
        '--sea',
        'test.blob',
      ])
      expect(result.output).toContain('executable')
    })

    it('inject without --output should show error', async () => {
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        'test.bin',
        '--sea',
        'test.blob',
      ])
      expect(result.output).toContain('output')
    })

    it('inject without --sea or --vfs should show error', async () => {
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        'test.bin',
        '-o',
        'out.bin',
      ])
      expect(result.output).toMatch(/sea|vfs/)
    })

    it('inject with nonexistent executable should show error', async () => {
      const resource = await createTestResource('test.blob')
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        '/nonexistent/binary',
        '-o',
        'out.bin',
        '--sea',
        resource,
      ])
      expect(result.output).toMatch(/(?:cannot open|error|not found|unknown)/i)
    })

    it('inject with nonexistent resource should show error', async () => {
      const binary = await createTestBinary('test.bin')
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        'out.bin',
        '--sea',
        '/nonexistent/resource',
      ])
      expect(result.output).toMatch(/(?:cannot open|error|not found)/i)
    })
  })

  describe('single Resource Injection', () => {
    it('--sea injection should create output file', async () => {
      // Copy binject binary itself to a temp location we can modify (much smaller than Node.js)
      const binary = path.join(testDir, 'test-binary')
      await fs.copyFile(BINJECT, binary)
      await makeExecutable(binary)

      const resource = await createTestResource('test.blob')
      const output = path.join(testDir, 'output-sea.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        resource,
      ])

      // All platforms should succeed with --sea injection
      expect(result.output).toMatch(/(?:Success|injected)/i)
      await expect(
        // oxlint-disable-next-line socket/prefer-exists-sync -- many access(X_OK) and access(F_OK) calls check executable permission / output-file readiness inside Promise.all races; existsSync (sync, no permission check) is not a substitute.
        fs.access(output, FS_CONSTANTS.F_OK),
      ).resolves.toBeUndefined()
    })

    it('--vfs without --sea should show error', async () => {
      const binary = await createTestBinary('test-vfs-only.bin')
      const resource = await createTestResource('test.tar')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        path.join(testDir, 'out.bin'),
        '--vfs',
        resource,
      ])

      // Should error with helpful message about requiring --sea
      expect(result.code).not.toBe(0)
      expect(result.output).toMatch(/--vfs requires --sea/i)
      expect(result.output).toMatch(/Virtual File System.*alongside.*SEA/i)
    })
  })

  describe('batch Injection', () => {
    it('batch injection (--sea + --vfs) should create output file', async () => {
      const binary = await createTestBinary('test-batch.bin')
      const seaResource = await createTestResource('test.blob')
      const vfsResource = await createTestResource('test.tar')
      const output = path.join(testDir, 'output-batch.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        seaResource,
        '--vfs',
        vfsResource,
      ])

      expect(result.output).toMatch(/(?:Success|both|injected)/i)
      await expect(
        // oxlint-disable-next-line socket/prefer-exists-sync -- many access(X_OK) and access(F_OK) calls check executable permission / output-file readiness inside Promise.all races; existsSync (sync, no permission check) is not a substitute.
        fs.access(output, FS_CONSTANTS.F_OK),
      ).resolves.toBeUndefined()
    })
  })

  describe('output Parameter', () => {
    it('inject without -o should show error about missing output', async () => {
      const binary = await createTestBinary('test-no-output.bin')
      const resource = await createTestResource('test.blob')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '--sea',
        resource,
      ])
      expect(result.output).toContain('output')
    })

    it('inject should create output in different directory', async () => {
      // Copy binject binary itself to a temp location we can modify (much smaller than Node.js)
      const binary = path.join(testDir, 'test-binary-dir')
      await fs.copyFile(BINJECT, binary)
      await makeExecutable(binary)

      const resource = await createTestResource('test.blob')
      const subdir = path.join(testDir, 'subdir')
      await fs.mkdir(subdir, { recursive: true })
      const output = path.join(subdir, 'output.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        resource,
      ])

      // All platforms should succeed with --sea injection
      expect(result.code).toBe(0)
      await expect(
        // oxlint-disable-next-line socket/prefer-exists-sync -- many access(X_OK) and access(F_OK) calls check executable permission / output-file readiness inside Promise.all races; existsSync (sync, no permission check) is not a substitute.
        fs.access(output, FS_CONSTANTS.F_OK),
      ).resolves.toBeUndefined()
    })
  })

  describe('list Command', () => {
    it('list command should run on binary', async () => {
      const binary = await createTestBinary('test-list.bin')

      const result = await execCommand(BINJECT, ['list', binary])
      expect(result.output).toMatch(/(?:Listing|resources|sections)/i)
    })
  })

  describe('extract Command', () => {
    it('extract without section flag should show error', async () => {
      const binary = await createTestBinary('test-extract.bin')

      const result = await execCommand(BINJECT, [
        'extract',
        '-e',
        binary,
        '-o',
        'output.blob',
      ])
      expect(result.output).toMatch(/(?:either|sea|vfs)/i)
    })

    it('extract without --output should show error', async () => {
      const binary = await createTestBinary('test-extract2.bin')

      const result = await execCommand(BINJECT, [
        'extract',
        '-e',
        binary,
        '--sea',
      ])
      expect(result.output).toMatch(/output/i)
    })
  })

  describe('verify Command', () => {
    it('verify without section flag should show error', async () => {
      const binary = await createTestBinary('test-verify.bin')

      const result = await execCommand(BINJECT, ['verify', '-e', binary])
      expect(result.output).toMatch(/(?:either|sea|vfs)/i)
    })
  })

  describe('invalid Flag Combinations', () => {
    it('--sea and --vfs together should enable batch injection', async () => {
      const binary = await createTestBinary('test-flags.bin')
      const resource = await createTestResource('test.blob')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        path.join(testDir, 'out.bin'),
        '--sea',
        resource,
        '--vfs',
        resource,
      ])

      expect(result.output).toMatch(/(?:Success|batch|both|injected)/i)
    })
  })
})

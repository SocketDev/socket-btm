import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * @file Edge case tests for BINJECT_NODE_PATH: long paths and symlinks.
 *   Split from binject-node-path-env.test.mts.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { makeExecutable } from 'build-infra/lib/build-helpers'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { execCommand } from './binject-node-path-env.test.mts'
import { getBinjectPath } from './helpers/paths.mts'

const BINJECT = getBinjectPath()

let testDir: string
let binjectExists = false

async function createTestBinject(name = 'test-binject') {
  const testBinject = path.join(testDir, name)
  await fs.copyFile(BINJECT, testBinject)
  await makeExecutable(testBinject)
  return testBinject
}

describe('bINJECT_NODE_PATH edge cases', () => {
  beforeAll(async () => {
    binjectExists = existsSync(BINJECT)
    if (!binjectExists) {
      return
    }

    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-edge-cases-'))
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

  it('should reject paths longer than PATH_MAX', async () => {
    const jsFile = path.join(testDir, 'app-longpath.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    const configFile = path.join(testDir, 'sea-config-longpath.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-longpath.js',
        output: 'app-longpath.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-longpath')
    const testBinject = await createTestBinject('test-binject-longpath')

    const longPath = `/tmp/${'a'.repeat(5000)}/node`

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: longPath,
        },
      },
    )

    expect(result.code).not.toBe(0)
    expect(result.output).toMatch(
      /BINJECT_NODE_PATH is set but binary is invalid/,
    )
  }, 30_000)

  it.skipIf(process.platform === 'win32')(
    'should handle symlinks to valid node binary',
    async () => {
      const jsFile = path.join(testDir, 'app-symlink.js')
      await fs.writeFile(jsFile, "console.log('Hello');\n")

      const configFile = path.join(testDir, 'sea-config-symlink.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          main: 'app-symlink.js',
          output: 'app-symlink.blob',
        }),
      )

      const outputBinary = path.join(testDir, 'output-symlink')
      const testBinject = await createTestBinject('test-binject-symlink')

      const symlinkPath = path.join(testDir, 'node-symlink')
      await fs.symlink(process.execPath, symlinkPath)

      const result = await execCommand(
        BINJECT,
        ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
        {
          cwd: testDir,
          env: {
            ...process.env,
            BINJECT_NODE_PATH: symlinkPath,
          },
        },
      )

      expect(result.code).toBe(0)
      expect(existsSync(outputBinary)).toBeTruthy()
    },
    60_000,
  )

  it.skipIf(process.platform === 'win32')(
    'should fail when symlink points to non-existent target',
    async () => {
      const jsFile = path.join(testDir, 'app-badsymlink.js')
      await fs.writeFile(jsFile, "console.log('Hello');\n")

      const configFile = path.join(testDir, 'sea-config-badsymlink.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          main: 'app-badsymlink.js',
          output: 'app-badsymlink.blob',
        }),
      )

      const outputBinary = path.join(testDir, 'output-badsymlink')
      const testBinject = await createTestBinject('test-binject-badsymlink')

      const brokenSymlink = path.join(testDir, 'broken-symlink')
      await fs.symlink('/nonexistent/path/to/node', brokenSymlink)

      const result = await execCommand(
        BINJECT,
        ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
        {
          cwd: testDir,
          env: {
            ...process.env,
            BINJECT_NODE_PATH: brokenSymlink,
          },
        },
      )

      expect(result.code).not.toBe(0)
      expect(result.output).toMatch(
        /BINJECT_NODE_PATH is set but binary is invalid/,
      )
    },
    30_000,
  )
})

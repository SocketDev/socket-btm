/**
 * SEA Config VFS edge-case tests (vfs: false, missing source). Split out
 * of sea-config-vfs.test.mts to keep both files under the file-size soft
 * cap; shares the same setupSeaConfigVfsTestDir fixture.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { getBinjectPath } from './helpers/paths.mts'
import { execCommand } from './helpers/exec-command-with-output.mts'
import { findNodeBinary } from './helpers/find-node-smol-binary.mts'
import { setupSeaConfigVfsTestDir } from './helpers/sea-config-vfs-setup.mts'

const BINJECT = getBinjectPath()

let testDir: string
let binjectExists = false
let nodeBinary: string | undefined = undefined

describe('sEA Config VFS Configuration (edge cases)', () => {
  beforeAll(async () => {
    binjectExists = existsSync(BINJECT)
    if (!binjectExists) {
      return
    }

    const fixture = await setupSeaConfigVfsTestDir(
      findNodeBinary,
      'binject-vfs-config-edge-',
    )
    binjectExists = fixture.binjectExists
    nodeBinary = fixture.nodeBinary
    testDir = fixture.testDir
  })

  beforeEach(ctx => {
    if (!binjectExists || !nodeBinary) {
      ctx.skip()
    }
  })

  afterAll(async () => {
    if (testDir) {
      await safeDelete(testDir)
    }
  })

  it('should handle vfs: false correctly', async () => {
    if (!nodeBinary) {
      return
    }
    // Create JS file.
    const jsFile = path.join(testDir, 'app-false.js')
    await fs.writeFile(jsFile, "console.log('No VFS');\n")

    // Create SEA config with vfs: false.
    const configFile = path.join(testDir, 'sea-config-false.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-false.js',
        output: 'sea-false.blob',
        smol: {
          vfs: false,
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-false')
    // Removed: const testBinject = await createTestBinject('test-binject-false')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should NOT show VFS configuration messages.
    expect(result.output).not.toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
  }, 60_000)

  it('should skip VFS gracefully when source not found', async () => {
    if (!nodeBinary) {
      return
    }
    // Create JS file.
    const jsFile = path.join(testDir, 'app-skip.js')
    await fs.writeFile(jsFile, "console.log('Skip VFS');\n")

    // Create SEA config with non-existent source.
    const configFile = path.join(testDir, 'sea-config-skip.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-skip.js',
        output: 'sea-skip.blob',
        smol: {
          vfs: {
            mode: 'on-disk',
            source: 'non-existent-directory',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-skip')
    // Removed: const testBinject = await createTestBinject('test-binject-skip')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed (skip VFS gracefully).
    expect(result.code).toBe(0)

    // Should show skip message.
    expect(result.output).toMatch(/VFS: Source not found.*skipping VFS/)
  }, 60_000)
})

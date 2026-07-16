import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
/**
 * SEA Config VFS Tests.
 *
 * Tests VFS configuration in sea-config.json smol section. Verifies that
 * binject correctly handles VFS config from sea-config.json: 1. Boolean
 * shorthand (vfs: true) 2. Empty object (vfs: {}) 3. Full configuration with
 * mode and source 4. CLI flag override priority 5. Different source types
 * (directory, .tar, .tar.gz)
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { getBinjectPath } from './helpers/paths.mts'
import { execCommand } from './helpers/exec-command-with-output.mts'
import { findNodeBinary } from './helpers/find-node-smol-binary.mts'
import { setupSeaConfigVfsTestDir } from './helpers/sea-config-vfs-setup.mts'

const BINJECT = getBinjectPath()

let testDir: string
let binjectExists = false
let nodeBinary: string | undefined = undefined

describe('sEA Config VFS Configuration', () => {
  beforeAll(async () => {
    // Check if binject binary exists.
    binjectExists = existsSync(BINJECT)
    if (!binjectExists) {
      return
    }

    const fixture = await setupSeaConfigVfsTestDir(
      findNodeBinary,
      'binject-vfs-config-',
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

  it('should support boolean shorthand vfs: true with defaults', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app.js')
    await fs.writeFile(jsFile, "console.log('Hello VFS');\n")

    // Create SEA config with vfs: true.
    const configFile = path.join(testDir, 'sea-config-bool.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app.js',
        output: 'sea-bool.blob',
        smol: {
          vfs: true,
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-bool')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary!, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration messages.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )

    // Should use defaults (in-memory mode, node_modules source).
    expect(result.output).toMatch(/VFS|node_modules/)
  }, 60_000)

  it('should support empty object vfs: {} with defaults', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-empty.js')
    await fs.writeFile(jsFile, "console.log('Empty VFS');\n")

    // Create SEA config with vfs: {}.
    const configFile = path.join(testDir, 'sea-config-empty.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-empty.js',
        output: 'sea-empty.blob',
        smol: {
          vfs: {},
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-empty')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary!, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration messages.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
  }, 60_000)

  it('should support full VFS config with directory source', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-dir.js')
    await fs.writeFile(jsFile, "console.log('Dir VFS');\n")

    // Create SEA config with full VFS configuration.
    const configFile = path.join(testDir, 'sea-config-dir.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-dir.js',
        output: 'sea-dir.blob',
        smol: {
          vfs: {
            mode: 'on-disk',
            source: 'node_modules',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-dir')
    // Removed: const testBinject = await createTestBinject('test-binject-dir')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary!, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration and archive creation.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
    expect(result.output).toMatch(/Creating VFS archive from directory/)
  }, 60_000)

  it('should support VFS config with .tar source', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-tar.js')
    await fs.writeFile(jsFile, "console.log('TAR VFS');\n")

    // Create SEA config with .tar source.
    const configFile = path.join(testDir, 'sea-config-tar.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-tar.js',
        output: 'sea-tar.blob',
        smol: {
          vfs: {
            mode: 'in-memory',
            source: 'vfs-test.tar',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-tar')
    // Removed: const testBinject = await createTestBinject('test-binject-tar')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary!, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration and compression.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
    expect(result.output).toMatch(/Compressing VFS archive/)
  }, 60_000)

  it('should support VFS config with .tar.gz source', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-targz.js')
    await fs.writeFile(jsFile, "console.log('TAR.GZ VFS');\n")

    // Create SEA config with .tar.gz source.
    const configFile = path.join(testDir, 'sea-config-targz.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-targz.js',
        output: 'sea-targz.blob',
        smol: {
          vfs: {
            mode: 'on-disk',
            source: 'vfs-test.tar.gz',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-targz')
    // Removed: const testBinject = await createTestBinject('test-binject-targz')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary!, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration (no compression needed).
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
  }, 60_000)

  it('should support compat mode without source', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-compat.js')
    await fs.writeFile(jsFile, "console.log('Compat VFS');\n")

    // Create SEA config with compat mode.
    const configFile = path.join(testDir, 'sea-config-compat.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-compat.js',
        output: 'sea-compat.blob',
        smol: {
          vfs: {
            mode: 'compat',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-compat')
    // Removed: const testBinject = await createTestBinject('test-binject-compat')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary!, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration for compat mode.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
  }, 60_000)

  it('should prioritize CLI flags over sea-config.json', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-override.js')
    await fs.writeFile(jsFile, "console.log('Override VFS');\n")

    // Create VFS blob for CLI flag.
    const cliVfsBlob = path.join(testDir, 'cli-vfs.blob')
    await fs.writeFile(cliVfsBlob, 'CLI VFS data\n')

    // Create SEA config with VFS (should be overridden).
    const configFile = path.join(testDir, 'sea-config-override.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-override.js',
        output: 'sea-override.blob',
        smol: {
          vfs: {
            mode: 'on-disk',
            source: 'node_modules',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-override')
    // Removed: const testBinject = await createTestBinject('test-binject-override')

    const result = await execCommand(
      BINJECT,
      [
        'inject',
        '-e',
        nodeBinary!,
        '-o',
        outputBinary,
        '--sea',
        configFile,
        '--vfs',
        cliVfsBlob,
      ],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show CLI override message.
    expect(result.output).toMatch(/CLI VFS flags override sea-config.json/)
  }, 60_000)

  it('should handle vfs: false correctly', async () => {
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
      ['inject', '-e', nodeBinary!, '-o', outputBinary, '--sea', configFile],
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
      ['inject', '-e', nodeBinary!, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed (skip VFS gracefully).
    expect(result.code).toBe(0)

    // Should show skip message.
    expect(result.output).toMatch(/VFS: Source not found.*skipping VFS/)
  }, 60_000)
})

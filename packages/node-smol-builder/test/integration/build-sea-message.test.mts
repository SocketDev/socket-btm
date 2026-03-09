/**
 * @fileoverview Tests that --build-sea displays the binject informational message.
 *
 * Verifies that when users run `node --build-sea`, they see an informational
 * message about binject as an enhanced SEA tool for node-smol binaries.
 *
 * Note: These tests require a built smol binary at build/{dev,prod}/out/Final/node/.
 * Run `pnpm build --dev` first to create the binary.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mjs'

// Get the latest Final binary from build/{dev,prod}/out/Final/node/
const finalBinaryPath = getLatestFinalBinary()

// Skip all tests if no final binary is available
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath)

// Use system temp directory for test artifacts
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-build-sea-message-test')

describe.skipIf(skipTests)('--build-sea binject message', () => {
  beforeAll(async () => {
    await fs.mkdir(testTmpDir, { recursive: true })
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
  })

  it('should display binject informational message', async () => {
    // Create a minimal valid SEA config
    const testDir = path.join(testTmpDir, 'message-test')
    await fs.mkdir(testDir, { recursive: true })

    const codeFile = path.join(testDir, 'app.js')
    await fs.writeFile(codeFile, 'console.log("test");', 'utf8')

    const blobFile = path.join(testDir, 'sea-blob.bin')
    const executableCopy = path.join(testDir, 'node-copy')

    // Copy the node binary as the target executable
    await fs.copyFile(finalBinaryPath, executableCopy)

    const configFile = path.join(testDir, 'sea-config.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: codeFile,
        output: blobFile,
      }),
      'utf8',
    )

    // Run --build-sea and capture output
    const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
      cwd: testDir,
      timeout: 30_000,
    })

    // Verify the message is displayed
    expect(result.stdout).toContain("Instead of --build-sea try 'binject'")
    expect(result.stdout).toContain('a SEA tool for node-smol featuring:')
    expect(result.stdout).toContain('Cross-platform injection')
    expect(result.stdout).toContain(
      'Virtual Filesystem (VFS) for embedding files',
    )
    expect(result.stdout).toContain(
      'Update notifications and auto-updater support',
    )
    expect(result.stdout).toContain(
      'Download: https://github.com/SocketDev/socket-btm/releases',
    )
    expect(result.stdout).toContain('Documentation: binject --help')
    expect(result.stdout).toContain('Building SEA with Node.js built-in tool')
  })

  it('should still build SEA successfully after showing message', async () => {
    // Verify the message doesn't break the build process
    const testDir = path.join(testTmpDir, 'build-success-test')
    await fs.mkdir(testDir, { recursive: true })

    const codeFile = path.join(testDir, 'app.js')
    await fs.writeFile(codeFile, 'console.log("Hello from SEA");', 'utf8')

    const blobFile = path.join(testDir, 'sea-blob.bin')
    const executableCopy = path.join(testDir, 'node-copy')

    await fs.copyFile(finalBinaryPath, executableCopy)

    const configFile = path.join(testDir, 'sea-config.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: codeFile,
        output: blobFile,
        executable: executableCopy,
      }),
      'utf8',
    )

    // Run --build-sea
    const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
      cwd: testDir,
      timeout: 30_000,
    })

    // Verify build succeeded (exit code 0)
    expect(result.status).toBe(0)

    // Verify blob was created
    expect(existsSync(blobFile)).toBe(true)
    const blobStats = await fs.stat(blobFile)
    expect(blobStats.size).toBeGreaterThan(0)
  })
})

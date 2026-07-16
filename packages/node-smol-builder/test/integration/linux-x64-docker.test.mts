import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * @file Integration tests for linux-x64 Docker build validation.
 *   Tests the complete linux-x64 build pipeline:
 *
 *   1. Node-smol extraction to ~/.socket/_dlx/<hash>/node
 *   2. Basic execution (--version, --eval)
 *   3. SEA creation with binject Repacking and build artifact tests live in
 *      linux-x64-docker-repack.test.mts. Note: These tests require a built
 *      Final binary at build/{dev,prod}/{platform-arch}/out/Final/node/. Run
 *      `pnpm build --dev --platform=linux --arch=x64` first to create the
 *      binary.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { makeExecutable } from 'build-infra/lib/build-helpers'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getSocketDlxDir } from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { MACHO_SEGMENT_NODE_SEA } from 'bin-infra/test/helpers/segment-names'
import { runBinject } from '../helpers/binject.mts'
import { getLatestFinalBinary } from '../paths.mts'

// Get the latest Final binary from build/{dev,prod}/{platform-arch}/out/Final/node/
const finalBinaryPath = getLatestFinalBinary()

// Skip all tests if not on Linux (these tests validate ELF binaries and
// Linux-specific behavior) or if no final binary is available.
const isLinux = os.platform() === 'linux'
const skipTests = !isLinux || !finalBinaryPath || !existsSync(finalBinaryPath)

const testTmpDir = path.join(os.tmpdir(), 'socket-btm-linux-x64-docker-tests')
const DLX_DIR = getSocketDlxDir()

/**
 * Calculate the content hash for a file (matches node-smol extraction logic).
 *
 * @param {string} filePath - Path to the file.
 *
 * @returns {Promise<string>} SHA-256 hash of the file contents
 */
export async function calculateFileHash(filePath) {
  const content = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

describe.skipIf(skipTests)('linux-x64 Docker build integration', () => {
  beforeAll(async () => {
    await fs.mkdir(testTmpDir, { recursive: true })
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
  })

  describe('node-smol binary extraction and execution', () => {
    it('should extract node-smol to ~/.socket/_dlx/<hash>/node', async () => {
      // Note: Final binary may be compressed or uncompressed depending on build flags
      const execResult = await spawn(finalBinaryPath, ['--version'], {
        timeout: 30_000,
      })

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toMatch(/^v\d+\.\d+\.\d+/)

      // Check if extraction occurred (only for compressed binaries)
      // Compressed binaries extract to ~/.socket/_dlx/<hash>/node
      const hash = await calculateFileHash(finalBinaryPath)
      const extractedNodePath = path.join(DLX_DIR, hash, 'node')

      // If the binary is compressed, it should extract to the cache directory
      // If it's uncompressed (dev builds), the cache may not exist
      if (existsSync(extractedNodePath)) {
        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size and stats.mode to verify extracted/final Linux x64 binaries.
        const extractedStat = await fs.stat(extractedNodePath)
        expect(extractedStat.isFile()).toBeTruthy()
        // Executable bit
        expect(extractedStat.mode & 0o111).toBeTruthy()
      }
    })

    it('should execute --version successfully', async () => {
      const execResult = await spawn(finalBinaryPath, ['--version'], {
        timeout: 10_000,
      })

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toMatch(/^v\d+\.\d+\.\d+/)
    })

    it('should execute --eval hello world', async () => {
      const execResult = await spawn(
        finalBinaryPath,
        ['--eval', 'console.log("hello world")'],
        {
          timeout: 10_000,
        },
      )

      expect(execResult.code).toBe(0)
      expect(execResult.stdout.trim()).toBe('hello world')
    })

    it('should execute --eval with process info', async () => {
      const evalCode =
        'console.log(JSON.stringify({ platform: process.platform, arch: process.arch, version: process.version }))'
      const execResult = await spawn(finalBinaryPath, ['--eval', evalCode], {
        timeout: 10_000,
      })

      expect(execResult.code).toBe(0)

      const info = JSON.parse(execResult.stdout.trim())
      expect(info.platform).toBe('linux')
      expect(info.arch).toBe('x64')
      expect(info.version).toMatch(/^v\d+\.\d+\.\d+/)
    })
  })

  describe('sEA creation with binject', () => {
    it(
      'should create simple hello world SEA using sea-config.json',
      { timeout: 30_000 },
      async () => {
        const testDir = path.join(testTmpDir, 'sea-hello-world')
        await fs.mkdir(testDir, { recursive: true })

        // Create simple hello world application
        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `#!/usr/bin/env node
console.log('Hello from SEA!');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
console.log('Is SEA:', require('node:sea').isSea());
`,
        )

        // Create SEA config
        const seaConfig = path.join(testDir, 'sea-config.json')
        await fs.writeFile(
          seaConfig,
          JSON.stringify({
            disableExperimentalSEAWarning: true,
            main: 'app.js',
            output: 'app.blob',
            useCodeCache: true,
          }),
        )

        // Copy binary for SEA creation
        const seaBinary = path.join(testDir, 'hello-sea')
        await fs.copyFile(finalBinaryPath, seaBinary)
        await makeExecutable(seaBinary)

        // Inject SEA blob using binject (it generates the blob from sea-config.json)
        const injectResult = await runBinject(
          seaBinary,
          'NODE_SEA_BLOB',
          'sea-config.json',
          {
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            testDir,
          },
        )

        expect(injectResult.code).toBe(0)
        expect(injectResult.stdout).not.toContain('error')
        expect(injectResult.stderr).not.toContain('error')

        // Execute SEA and verify
        const execResult = await spawn(seaBinary, [], {
          cwd: testDir,
          timeout: 10_000,
        })

        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('Hello from SEA!')
        expect(execResult.stdout).toContain('Platform: linux')
        expect(execResult.stdout).toContain('Architecture: x64')
        expect(execResult.stdout).toContain('Is SEA: true')
      },
    )

    it(
      'should create SEA with VFS using sea-config.json',
      { timeout: 30_000 },
      async () => {
        const testDir = path.join(testTmpDir, 'sea-with-vfs')
        await fs.mkdir(testDir, { recursive: true })

        // Create application that uses VFS
        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          // oxlint-disable-next-line socket/no-status-emoji -- emoji literals are embedded in test fixture JS source executed inside the SEA binary and asserted via toContain(); the runtime can't call logger.success() because it runs without our logger import.
          `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const process = require('node:process')


console.log('=== SEA with VFS Test ===');
console.log('Is SEA:', require('node:sea').isSea());

// Check VFS
const hasVFS = typeof process._vfs !== 'undefined';
console.log('VFS available:', hasVFS);

if (hasVFS) {
  console.log('VFS files:', Object.keys(process._vfs).length);

  // Read package.json from VFS
  try {
    const pkg = JSON.parse(fs.readFileSync('/vfs/package.json', 'utf8'));
    console.log('Package name:', pkg.name);
    console.log('Package version:', pkg.version);
  } catch (e) {
    console.error('Failed to read VFS:', e.message);
    process.exit(1);
  }
}

console.log('✓ Test completed successfully');
`,
        )

        // Create SEA config
        const seaConfig = path.join(testDir, 'sea-config.json')
        await fs.writeFile(
          seaConfig,
          JSON.stringify({
            disableExperimentalSEAWarning: true,
            main: 'app.js',
            output: 'app.blob',
            useCodeCache: true,
          }),
        )

        // Create VFS content
        const vfsDir = path.join(testDir, 'vfs-content')
        await fs.mkdir(vfsDir, { recursive: true })
        await fs.writeFile(
          path.join(vfsDir, 'package.json'),
          JSON.stringify({
            description: 'Test SEA application with VFS',
            name: 'test-sea-vfs-app',
            version: '1.0.0',
          }),
        )

        // Create VFS tar.gz
        const vfsTarGz = path.join(testDir, 'vfs.tar.gz')
        const tarResult = await spawn(
          'tar',
          ['czf', vfsTarGz, '-C', vfsDir, '.'],
          { cwd: testDir },
        )
        expect(tarResult.code).toBe(0)

        // Copy binary for dual injection
        const seaBinary = path.join(testDir, 'hello-sea-vfs')
        await fs.copyFile(finalBinaryPath, seaBinary)
        await makeExecutable(seaBinary)

        // Inject both SEA and VFS using binject
        const injectResult = await runBinject(
          seaBinary,
          'BOTH',
          { sea: 'sea-config.json', vfs: vfsTarGz },
          {
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            testDir,
          },
        )

        expect(injectResult.code).toBe(0)
        expect(injectResult.stdout).not.toContain('error')

        // Execute SEA with VFS and verify
        const execResult = await spawn(seaBinary, [], {
          cwd: testDir,
          timeout: 10_000,
        })

        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('Is SEA: true')
        expect(execResult.stdout).toContain('VFS available: true')
        expect(execResult.stdout).toContain('Package name: test-sea-vfs-app')
        // oxlint-disable-next-line socket/no-status-emoji -- emoji literals are embedded in test fixture JS source executed inside the SEA binary and asserted via toContain(); the runtime can't call logger.success() because it runs without our logger import.
        expect(execResult.stdout).toContain('✓ Test completed successfully')
      },
    )
  })
})

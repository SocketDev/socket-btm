/**
 * @fileoverview Integration tests for linux-x64 Docker build validation.
 *
 * Tests the complete linux-x64 build pipeline:
 * 1. Node-smol extraction to ~/.socket/_dlx/<hash>/node
 * 2. Basic execution (--version, --eval)
 * 3. SEA creation with binject
 * 4. Repacking and re-execution without errors
 *
 * These tests validate that binject, binpress, stubs, and node-smol work correctly
 * in the linux-x64 Docker build environment.
 *
 * Note: These tests require a built Final binary at build/{dev,prod}/out/Final/node/.
 * Run `pnpm build --dev --platform=linux --arch=x64` first to create the binary.
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { MACHO_SEGMENT_NODE_SEA } from '../../../bin-infra/test-helpers/segment-names.mjs'
import { runBinject } from '../helpers/binject.mjs'
import { getLatestFinalBinary } from '../paths.mjs'

// Get the latest Final binary from build/{dev,prod}/out/Final/node/
const finalBinaryPath = getLatestFinalBinary()

// Skip all tests if no final binary is available
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath)

const testTmpDir = path.join(tmpdir(), 'socket-btm-linux-x64-docker-tests')
const _DLX_DIR = path.join(homedir(), '.socket', '_dlx')

/**
 * Calculate the content hash for a file (matches node-smol extraction logic).
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} SHA-256 hash of the file contents
 */
async function calculateFileHash(filePath) {
  const content = await fs.readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

describe.skipIf(skipTests)('Linux-x64 Docker build integration', () => {
  beforeAll(async () => {
    await fs.mkdir(testTmpDir, { recursive: true })
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
  })

  describe('Node-smol binary extraction and execution', () => {
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
      const extractedNodePath = path.join(_DLX_DIR, hash, 'node')

      // If the binary is compressed, it should extract to the cache directory
      // If it's uncompressed (dev builds), the cache may not exist
      if (existsSync(extractedNodePath)) {
        const extractedStat = await fs.stat(extractedNodePath)
        expect(extractedStat.isFile()).toBe(true)
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

  describe('SEA creation with binject', () => {
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
            main: 'app.js',
            output: 'app.blob',
            disableExperimentalSEAWarning: true,
            useCodeCache: true,
          }),
        )

        // Copy binary for SEA creation
        const seaBinary = path.join(testDir, 'hello-sea')
        await fs.copyFile(finalBinaryPath, seaBinary)
        await fs.chmod(seaBinary, 0o755)

        // Inject SEA blob using binject (it generates the blob from sea-config.json)
        const injectResult = await runBinject(
          seaBinary,
          'NODE_SEA_BLOB',
          'sea-config.json',
          {
            testDir,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
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
          `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

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
  } catch (err) {
    console.error('Failed to read VFS:', err.message);
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
            main: 'app.js',
            output: 'app.blob',
            disableExperimentalSEAWarning: true,
            useCodeCache: true,
          }),
        )

        // Create VFS content
        const vfsDir = path.join(testDir, 'vfs-content')
        await fs.mkdir(vfsDir, { recursive: true })
        await fs.writeFile(
          path.join(vfsDir, 'package.json'),
          JSON.stringify({
            name: 'test-sea-vfs-app',
            version: '1.0.0',
            description: 'Test SEA application with VFS',
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
        await fs.chmod(seaBinary, 0o755)

        // Inject both SEA and VFS using binject
        const injectResult = await runBinject(
          seaBinary,
          'BOTH',
          { sea: 'sea-config.json', vfs: vfsTarGz },
          {
            testDir,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
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
        expect(execResult.stdout).toContain('✓ Test completed successfully')
      },
    )
  })

  describe('Repacking verification', () => {
    it(
      'should repack SEA without extraction/execution errors',
      { timeout: 45_000 },
      async () => {
        const testDir = path.join(testTmpDir, 'repack-test')
        await fs.mkdir(testDir, { recursive: true })

        // Create initial SEA application
        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `console.log('Initial SEA application');
console.log('Version:', process.version);
`,
        )

        const seaConfig = path.join(testDir, 'sea-config.json')
        await fs.writeFile(
          seaConfig,
          JSON.stringify({
            main: 'app.js',
            output: 'app.blob',
            disableExperimentalSEAWarning: true,
          }),
        )

        // Create first SEA binary
        const seaBinary1 = path.join(testDir, 'app-v1')
        await fs.copyFile(finalBinaryPath, seaBinary1)
        await fs.chmod(seaBinary1, 0o755)

        const inject1Result = await runBinject(
          seaBinary1,
          'NODE_SEA_BLOB',
          'sea-config.json',
          {
            testDir,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
          },
        )
        expect(inject1Result.code).toBe(0)

        // Test first binary
        const exec1Result = await spawn(seaBinary1, [], {
          cwd: testDir,
          timeout: 10_000,
        })
        expect(exec1Result.code).toBe(0)
        expect(exec1Result.stdout).toContain('Initial SEA application')

        // Create updated application
        const appV2Js = path.join(testDir, 'app-v2.js')
        await fs.writeFile(
          appV2Js,
          `console.log('Repacked SEA application');
console.log('Version:', process.version);
console.log('Platform:', process.platform);
`,
        )

        const seaConfigV2 = path.join(testDir, 'sea-config-v2.json')
        await fs.writeFile(
          seaConfigV2,
          JSON.stringify({
            main: 'app-v2.js',
            output: 'app-v2.blob',
            disableExperimentalSEAWarning: true,
          }),
        )

        // Repack: copy the stub again and inject new SEA
        const seaBinary2 = path.join(testDir, 'app-v2')
        await fs.copyFile(finalBinaryPath, seaBinary2)
        await fs.chmod(seaBinary2, 0o755)

        const inject2Result = await runBinject(
          seaBinary2,
          'NODE_SEA_BLOB',
          'sea-config-v2.json',
          {
            testDir,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
          },
        )
        expect(inject2Result.code).toBe(0)
        expect(inject2Result.stdout).not.toContain('error')

        // Test repacked binary - should NOT have extraction errors
        const exec2Result = await spawn(seaBinary2, [], {
          cwd: testDir,
          timeout: 10_000,
        })
        expect(exec2Result.code).toBe(0)
        expect(exec2Result.stdout).toContain('Repacked SEA application')
        expect(exec2Result.stdout).toContain('Platform: linux')
        expect(exec2Result.stderr).not.toContain('error')
        expect(exec2Result.stderr).not.toContain('extraction failed')
        expect(exec2Result.stderr).not.toContain('segfault')
      },
    )

    it(
      'should handle multiple repack cycles without errors',
      { timeout: 60_000 },
      async () => {
        const testDir = path.join(testTmpDir, 'multi-repack-test')
        await fs.mkdir(testDir, { recursive: true })

        const versions = ['v1', 'v2', 'v3']

        for (const version of versions) {
          // Create application for this version
          const appJs = path.join(testDir, `app-${version}.js`)
          // eslint-disable-next-line no-await-in-loop
          await fs.writeFile(
            appJs,
            `console.log('Application ${version}');
console.log('Node version:', process.version);
`,
          )

          const seaConfig = path.join(testDir, `sea-config-${version}.json`)
          // eslint-disable-next-line no-await-in-loop
          await fs.writeFile(
            seaConfig,
            JSON.stringify({
              main: `app-${version}.js`,
              output: `app-${version}.blob`,
              disableExperimentalSEAWarning: true,
            }),
          )

          // Create SEA binary
          const seaBinary = path.join(testDir, `app-${version}`)
          // eslint-disable-next-line no-await-in-loop
          await fs.copyFile(finalBinaryPath, seaBinary)
          // eslint-disable-next-line no-await-in-loop
          await fs.chmod(seaBinary, 0o755)

          // eslint-disable-next-line no-await-in-loop
          const injectResult = await runBinject(
            seaBinary,
            'NODE_SEA_BLOB',
            `sea-config-${version}.json`,
            {
              testDir,
              sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
              machoSegmentName: MACHO_SEGMENT_NODE_SEA,
            },
          )
          expect(injectResult.code).toBe(0)

          // Test execution
          // eslint-disable-next-line no-await-in-loop
          const execResult = await spawn(seaBinary, [], {
            cwd: testDir,
            timeout: 10_000,
          })
          expect(execResult.code).toBe(0)
          expect(execResult.stdout).toContain(`Application ${version}`)
          expect(execResult.stderr).not.toContain('error')
          expect(execResult.stderr).not.toContain('segfault')
        }
      },
    )
  })

  describe('Build artifacts verification', () => {
    it('should have correct ELF binary format for linux-x64', async () => {
      // Check that the binary is a valid ELF executable
      const fileResult = await spawn('file', [finalBinaryPath])
      expect(fileResult.code).toBe(0)
      expect(fileResult.stdout).toContain('ELF')
      expect(fileResult.stdout).toContain('x86-64')
      expect(fileResult.stdout).toContain('executable')
    })

    it('should be executable', async () => {
      const stat = await fs.stat(finalBinaryPath)

      // Check executable bit
      expect(stat.mode & 0o111).toBeTruthy()
    })

    it('should have reasonable size', async () => {
      const stat = await fs.stat(finalBinaryPath)
      // Node.js binaries should be between 10MB and 200MB
      // > 10MB
      expect(stat.size).toBeGreaterThan(10 * 1024 * 1024)
      // < 200MB
      expect(stat.size).toBeLessThan(200 * 1024 * 1024)
    })
  })
})

/**
 * @fileoverview Integration tests for node --build-sea with smol options.
 *
 * Tests the Socket Security smol extensions to Node.js SEA.
 * Based on: https://nodejs.org/api/single-executable-applications.html
 *
 * NOTE: --build-sea performs FULL injection (blob generation + binary injection),
 * not just blob generation. It uses the embedded binject functionality.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mjs'

// Get the latest Final binary from build/{dev,prod}/out/Final/node/
const finalBinaryPath = getLatestFinalBinary()

// Check if the binary was built with LIEF (required for --build-sea).
let hasLief = false
if (finalBinaryPath && existsSync(finalBinaryPath)) {
  try {
    const r = await spawn(
      finalBinaryPath,
      ['-e', 'console.log(!!process.config?.variables?.node_use_lief)'],
      { timeout: 5000 },
    )
    hasLief = (r.stdout ?? '').trim() === 'true'
  } catch {}
}

// Skip if no binary or binary lacks LIEF (--build-sea is a no-op without LIEF).
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath) || !hasLief

// Use system temp directory for test artifacts
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-build-sea-smol-test')

describe.skipIf(skipTests)('--build-sea with smol options', () => {
  beforeAll(async () => {
    await fs.mkdir(testTmpDir, { recursive: true })
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
  })

  describe('standard Node.js SEA options', () => {
    it('should build SEA with main and output', async () => {
      const testDir = path.join(testTmpDir, 'basic')
      await fs.mkdir(testDir, { recursive: true })

      const codeFile = path.join(testDir, 'app.js')
      await fs.writeFile(codeFile, 'console.log("Hello from SEA");', 'utf8')

      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')

      // Copy node binary as source for injection
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          executable: sourceExe,
          main: codeFile,
          output: outputExe,
        }),
        'utf8',
      )

      // Run --build-sea (generates blob AND injects into executable)
      const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })

      // Verify command succeeded
      expect(result.code).toBe(0)

      // Verify output executable was created
      expect(existsSync(outputExe)).toBeTruthy()

      // Verify it's different from source (has SEA blob injected)
      const sourceSize = (await fs.stat(sourceExe)).size
      const outputSize = (await fs.stat(outputExe)).size
      expect(outputSize).toBeGreaterThan(sourceSize)
    })

    it('should build SEA with disableExperimentalSEAWarning', async () => {
      const testDir = path.join(testTmpDir, 'no-warning')
      await fs.mkdir(testDir, { recursive: true })

      const codeFile = path.join(testDir, 'app.js')
      await fs.writeFile(codeFile, 'console.log("No warning");', 'utf8')

      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          disableExperimentalSEAWarning: true,
          executable: sourceExe,
          main: codeFile,
          output: outputExe,
        }),
        'utf8',
      )

      const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })

      expect(result.code).toBe(0)
      expect(existsSync(outputExe)).toBeTruthy()
    })

    it('should build SEA with assets', async () => {
      const testDir = path.join(testTmpDir, 'with-assets')
      await fs.mkdir(testDir, { recursive: true })

      const codeFile = path.join(testDir, 'app.js')
      await fs.writeFile(
        codeFile,
        `
        const { getAsset } = require('node:sea');
        const config = getAsset('config.json');
        console.log('Config:', config.toString());
      `,
        'utf8',
      )

      const assetFile = path.join(testDir, 'config.json')
      await fs.writeFile(assetFile, '{"name":"test"}', 'utf8')

      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          assets: {
            'config.json': assetFile,
          },
          disableExperimentalSEAWarning: true,
          executable: sourceExe,
          main: codeFile,
          output: outputExe,
        }),
        'utf8',
      )

      const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })

      expect(result.code).toBe(0)
      expect(existsSync(outputExe)).toBeTruthy()
    })
  })

  describe('smol VFS options', () => {
    it('should build SEA with VFS in on-disk mode', async () => {
      const testDir = path.join(testTmpDir, 'vfs-ondisk')
      await fs.mkdir(testDir, { recursive: true })

      const codeFile = path.join(testDir, 'app.js')
      await fs.writeFile(
        codeFile,
        'console.log("App with VFS on-disk");',
        'utf8',
      )

      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'data.txt'), 'VFS data', 'utf8')

      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          disableExperimentalSEAWarning: true,
          executable: sourceExe,
          main: codeFile,
          output: outputExe,
          smol: {
            vfs: {
              mode: 'on-disk',
              source: vfsDir,
            },
          },
        }),
        'utf8',
      )

      const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })

      expect(result.code).toBe(0)
      expect(existsSync(outputExe)).toBeTruthy()
    })

    it('should build SEA with VFS in in-memory mode', async () => {
      const testDir = path.join(testTmpDir, 'vfs-inmemory')
      await fs.mkdir(testDir, { recursive: true })

      const codeFile = path.join(testDir, 'app.js')
      await fs.writeFile(
        codeFile,
        'console.log("App with VFS in-memory");',
        'utf8',
      )

      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'data.txt'), 'VFS data', 'utf8')

      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          disableExperimentalSEAWarning: true,
          executable: sourceExe,
          main: codeFile,
          output: outputExe,
          smol: {
            vfs: {
              mode: 'in-memory',
              source: vfsDir,
            },
          },
        }),
        'utf8',
      )

      const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })

      expect(result.code).toBe(0)
      expect(existsSync(outputExe)).toBeTruthy()
    })

    it('should build SEA with VFS custom prefix', async () => {
      const testDir = path.join(testTmpDir, 'vfs-prefix')
      await fs.mkdir(testDir, { recursive: true })

      const codeFile = path.join(testDir, 'app.js')
      await fs.writeFile(codeFile, 'console.log("Custom prefix");', 'utf8')

      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'data.txt'), 'VFS data', 'utf8')

      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          disableExperimentalSEAWarning: true,
          executable: sourceExe,
          main: codeFile,
          output: outputExe,
          smol: {
            vfs: {
              mode: 'on-disk',
              source: vfsDir,
              prefix: '/app',
            },
          },
        }),
        'utf8',
      )

      const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })

      expect(result.code).toBe(0)
      expect(existsSync(outputExe)).toBeTruthy()
    })
  })

  describe('smol update options', () => {
    it('should build SEA with update configuration', async () => {
      const testDir = path.join(testTmpDir, 'with-update')
      await fs.mkdir(testDir, { recursive: true })

      const codeFile = path.join(testDir, 'app.js')
      await fs.writeFile(codeFile, 'console.log("With updates");', 'utf8')

      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          disableExperimentalSEAWarning: true,
          executable: sourceExe,
          main: codeFile,
          output: outputExe,
          smol: {
            update: {
              binname: 'my-app',
              command: 'update',
              url: 'https://releases.example.com',
              tag: 'v1.0.0',
              interval: 86_400_000,
              notify_interval: 86_400_000,
            },
          },
        }),
        'utf8',
      )

      const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })

      expect(result.code).toBe(0)
      expect(existsSync(outputExe)).toBeTruthy()
    })
  })

  describe('combined options', () => {
    it('should build SEA with both VFS and update config', async () => {
      const testDir = path.join(testTmpDir, 'vfs-and-update')
      await fs.mkdir(testDir, { recursive: true })

      const codeFile = path.join(testDir, 'app.js')
      await fs.writeFile(codeFile, 'console.log("VFS and updates");', 'utf8')

      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'data.txt'), 'VFS data', 'utf8')

      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          disableExperimentalSEAWarning: true,
          executable: sourceExe,
          main: codeFile,
          output: outputExe,
          smol: {
            vfs: {
              mode: 'on-disk',
              source: vfsDir,
            },
            update: {
              binname: 'my-app',
              command: 'update',
              url: 'https://releases.example.com',
              tag: 'v1.0.0',
              interval: 86_400_000,
              notify_interval: 86_400_000,
            },
          },
        }),
        'utf8',
      )

      const result = await spawn(finalBinaryPath, ['--build-sea', configFile], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })

      expect(result.code).toBe(0)
      expect(existsSync(outputExe)).toBeTruthy()
    })
  })

  describe('error handling', () => {
    it('should error with invalid config (missing main)', async () => {
      const testDir = path.join(testTmpDir, 'error-no-main')
      await fs.mkdir(testDir, { recursive: true })

      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          executable: sourceExe,
          output: outputExe,
        }),
        'utf8',
      )

      // Should throw/reject with non-zero exit
      await expect(
        spawn(finalBinaryPath, ['--build-sea', configFile], {
          cwd: testDir,
          timeout: 10_000,
        }),
      ).rejects.toThrow()
    })

    it('should error with nonexistent main file', async () => {
      const testDir = path.join(testTmpDir, 'error-no-file')
      await fs.mkdir(testDir, { recursive: true })

      const codeFile = path.join(testDir, 'nonexistent.js')
      const outputExe = path.join(testDir, 'app')
      const sourceExe = path.join(testDir, 'node-copy')
      await fs.copyFile(finalBinaryPath, sourceExe)

      const configFile = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          executable: sourceExe,
          main: codeFile,
          output: outputExe,
        }),
        'utf8',
      )

      await expect(
        spawn(finalBinaryPath, ['--build-sea', configFile], {
          cwd: testDir,
          timeout: 10_000,
        }),
      ).rejects.toThrow()
    })
  })
})

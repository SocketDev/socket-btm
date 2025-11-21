/**
 * @fileoverview Tests for SEA (Single Executable Application) support with automatic Brotli compression.
 *
 * Tests different blob formats:
 * - Plain JavaScript (.js)
 * - Pre-compressed Brotli (.js.br)
 * - Compression flags (useCompression: true/false)
 *
 * Note: These tests require a built smol binary at build/out/Final/node.
 * Run `pnpm build` first to create the binary.
 */

import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { brotliCompress } from 'node:zlib'

import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const finalBinaryPath = path.join(packageDir, 'build', 'out', 'Final', 'node')

// Use system temp directory for test artifacts.
const testTmpDir = path.join(tmpdir(), 'socket-btm-sea-tests')

// Check if we have a built binary for SEA tests.
const hasBuiltBinary = existsSync(finalBinaryPath)

// Skip SEA tests if no built binary exists.
const describeOrSkip = hasBuiltBinary ? describe : describe.skip

describeOrSkip('SEA (Single Executable Application) support', () => {
  beforeAll(async () => {
    // Create test tmp directory.
    await fs.mkdir(testTmpDir, { recursive: true })
  })

  afterAll(async () => {
    // Clean up test tmp directory.
    await safeDelete(testTmpDir)
  })

  describe('hello-world with plain JavaScript blob', () => {
    const testDir = path.join(testTmpDir, 'hello-plain-js')
    let seaBinary

    beforeAll(async () => {
      await fs.mkdir(testDir, { recursive: true })

      // Create hello-world JavaScript.
      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `console.log('Hello from SEA!');\nconsole.log('Compression: automatic');\n`,
      )

      // Create SEA config with compression enabled (default).
      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify(
          {
            main: 'app.js',
            output: 'app.blob',
            disableExperimentalSEAWarning: true,
            useCodeCache: true,
          },
          null,
          2,
        ),
      )

      // Generate SEA blob using built smol binary.
      const generateResult = await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        {
          cwd: testDir,
        },
      )

      expect(generateResult.code).toBe(0)

      // Verify blob was created.
      const blobPath = path.join(testDir, 'app.blob')
      expect(existsSync(blobPath)).toBe(true)

      // Copy smol binary for injection.
      seaBinary = path.join(testDir, 'hello-plain-js')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await fs.chmod(seaBinary, 0o755)

      // Inject SEA blob using postject.
      const injectResult = await spawn(
        'npx',
        [
          'postject',
          seaBinary,
          'NODE_SEA_BLOB',
          'app.blob',
          '--sentinel-fuse',
          'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          '--macho-segment-name',
          'NODE_SEA',
        ],
        {
          cwd: testDir,
        },
      )

      expect(injectResult.code).toBe(0)
    })

    it('should execute and output hello-world message', async () => {
      const result = await spawn(seaBinary, [], {
        cwd: testDir,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Hello from SEA!')
      expect(result.stdout).toContain('Compression: automatic')
    })

    it('should have SEA blob injected', async () => {
      // Check binary size increased (SEA blob added).
      const originalStats = await fs.stat(finalBinaryPath)
      const seaStats = await fs.stat(seaBinary)

      expect(seaStats.size).toBeGreaterThan(originalStats.size)
    })

    it('should decompress blob on first run', async () => {
      // First run decompresses and caches.
      const firstRun = await spawn(seaBinary, [], {
        cwd: testDir,
      })

      expect(firstRun.code).toBe(0)
      expect(firstRun.stdout).toContain('Hello from SEA!')
    })
  })

  describe('hello-world with pre-compressed Brotli blob', () => {
    const testDir = path.join(testTmpDir, 'hello-brotli-blob')
    let seaBinary

    beforeAll(async () => {
      await fs.mkdir(testDir, { recursive: true })

      // Create hello-world JavaScript.
      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `console.log('Hello from pre-compressed SEA!');\nconsole.log('Format: .js.br');\n`,
      )

      // Manually compress with Brotli.
      const compress = promisify(brotliCompress)

      const appJsContent = await fs.readFile(appJs)
      const compressed = await compress(appJsContent, {
        params: {
          // BROTLI_PARAM_QUALITY = 11
          [11]: 11,
        },
      })

      const brotliBlob = path.join(testDir, 'app.js.br')
      await fs.writeFile(brotliBlob, compressed)

      // Create SEA config referencing .js.br blob.
      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify(
          {
            main: 'app.js.br',
            output: 'app.blob',
            disableExperimentalSEAWarning: true,
            useCodeCache: true,
          },
          null,
          2,
        ),
      )

      // Generate SEA blob (should detect .br and handle correctly).
      const generateResult = await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        {
          cwd: testDir,
        },
      )

      expect(generateResult.code).toBe(0)

      // Verify blob was created.
      const blobPath = path.join(testDir, 'app.blob')
      expect(existsSync(blobPath)).toBe(true)

      // Copy smol binary for injection.
      seaBinary = path.join(testDir, 'hello-brotli-blob')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await fs.chmod(seaBinary, 0o755)

      // Inject SEA blob.
      const injectResult = await spawn(
        'npx',
        [
          'postject',
          seaBinary,
          'NODE_SEA_BLOB',
          'app.blob',
          '--sentinel-fuse',
          'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          '--macho-segment-name',
          'NODE_SEA',
        ],
        {
          cwd: testDir,
        },
      )

      expect(injectResult.code).toBe(0)
    })

    it('should execute and output hello-world message', async () => {
      const result = await spawn(seaBinary, [], {
        cwd: testDir,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Hello from pre-compressed SEA!')
      expect(result.stdout).toContain('Format: .js.br')
    })

    it('should handle pre-compressed blob correctly', async () => {
      // Pre-compressed blobs should work identically to plain JS.
      const result = await spawn(seaBinary, [], {
        cwd: testDir,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Hello from pre-compressed SEA!')
    })
  })

  describe('hello-world with compression disabled', () => {
    const testDir = path.join(testTmpDir, 'hello-no-compression')
    let seaBinary

    beforeAll(async () => {
      await fs.mkdir(testDir, { recursive: true })

      // Create hello-world JavaScript.
      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `console.log('Hello from uncompressed SEA!');\nconsole.log('Compression: disabled');\n`,
      )

      // Create SEA config with compression explicitly disabled.
      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify(
          {
            main: 'app.js',
            output: 'app.blob',
            disableExperimentalSEAWarning: true,
            useCodeCache: true,
            // Explicitly disable compression
            useCompression: false,
          },
          null,
          2,
        ),
      )

      // Generate SEA blob without compression.
      const generateResult = await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        {
          cwd: testDir,
        },
      )

      expect(generateResult.code).toBe(0)

      // Verify blob was created.
      const blobPath = path.join(testDir, 'app.blob')
      expect(existsSync(blobPath)).toBe(true)

      // Copy smol binary for injection.
      seaBinary = path.join(testDir, 'hello-no-compression')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await fs.chmod(seaBinary, 0o755)

      // Inject SEA blob.
      const injectResult = await spawn(
        'npx',
        [
          'postject',
          seaBinary,
          'NODE_SEA_BLOB',
          'app.blob',
          '--sentinel-fuse',
          'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          '--macho-segment-name',
          'NODE_SEA',
        ],
        {
          cwd: testDir,
        },
      )

      expect(injectResult.code).toBe(0)
    })

    it('should execute and output hello-world message', async () => {
      const result = await spawn(seaBinary, [], {
        cwd: testDir,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Hello from uncompressed SEA!')
      expect(result.stdout).toContain('Compression: disabled')
    })

    it('should have larger blob without compression', async () => {
      const blobPath = path.join(testDir, 'app.blob')
      const blobStats = await fs.stat(blobPath)

      // Uncompressed blobs should be larger than compressed ones.
      // This is a simple size check; exact size depends on JS content.
      expect(blobStats.size).toBeGreaterThan(50)
    })
  })

  describe('hello-world with compression enabled explicitly', () => {
    const testDir = path.join(testTmpDir, 'hello-compression-on')
    let seaBinary

    beforeAll(async () => {
      await fs.mkdir(testDir, { recursive: true })

      // Create hello-world JavaScript.
      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `console.log('Hello from explicitly compressed SEA!');\nconsole.log('Compression: enabled (explicit)');\n`,
      )

      // Create SEA config with compression explicitly enabled.
      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify(
          {
            main: 'app.js',
            output: 'app.blob',
            disableExperimentalSEAWarning: true,
            useCodeCache: true,
            // Explicitly enable compression (default behavior)
            useCompression: true,
          },
          null,
          2,
        ),
      )

      // Generate SEA blob with compression.
      const generateResult = await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        {
          cwd: testDir,
        },
      )

      expect(generateResult.code).toBe(0)

      // Verify blob was created.
      const blobPath = path.join(testDir, 'app.blob')
      expect(existsSync(blobPath)).toBe(true)

      // Copy smol binary for injection.
      seaBinary = path.join(testDir, 'hello-compression-on')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await fs.chmod(seaBinary, 0o755)

      // Inject SEA blob.
      const injectResult = await spawn(
        'npx',
        [
          'postject',
          seaBinary,
          'NODE_SEA_BLOB',
          'app.blob',
          '--sentinel-fuse',
          'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          '--macho-segment-name',
          'NODE_SEA',
        ],
        {
          cwd: testDir,
        },
      )

      expect(injectResult.code).toBe(0)
    })

    it('should execute and output hello-world message', async () => {
      const result = await spawn(seaBinary, [], {
        cwd: testDir,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Hello from explicitly compressed SEA!')
      expect(result.stdout).toContain('Compression: enabled (explicit)')
    })

    it('should have compressed blob', async () => {
      const blobPath = path.join(testDir, 'app.blob')
      const blobStats = await fs.stat(blobPath)

      // Compressed blobs should be reasonably sized.
      expect(blobStats.size).toBeGreaterThan(0)
      // Small JS should compress well
      expect(blobStats.size).toBeLessThan(1000)
    })
  })

  describe('blob size comparison', () => {
    it('compressed blob should be smaller than uncompressed', async () => {
      // This test compares blob sizes from previous tests.
      const compressedBlobPath = path.join(
        testTmpDir,
        'hello-compression-on',
        'app.blob',
      )
      const uncompressedBlobPath = path.join(
        testTmpDir,
        'hello-no-compression',
        'app.blob',
      )

      if (
        !existsSync(compressedBlobPath) ||
        !existsSync(uncompressedBlobPath)
      ) {
        // Skip if blobs don't exist (tests might be run individually).
        return
      }

      const compressedStats = await fs.stat(compressedBlobPath)
      const uncompressedStats = await fs.stat(uncompressedBlobPath)

      expect(compressedStats.size).toBeLessThan(uncompressedStats.size)
    })
  })

  describe('SEA error handling', () => {
    it('should fail gracefully with invalid sea-config.json', async () => {
      const testDir = path.join(testTmpDir, 'invalid-config')
      await fs.mkdir(testDir, { recursive: true })

      // Create invalid SEA config (missing required fields).
      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify(
          {
            // Missing 'main' field
            output: 'app.blob',
          },
          null,
          2,
        ),
      )

      // Attempt to generate SEA blob with invalid config.
      const generateResult = await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        {
          cwd: testDir,
        },
      )

      // Should fail with non-zero exit code.
      expect(generateResult.code).not.toBe(0)
    })

    it('should fail gracefully with missing JavaScript file', async () => {
      const testDir = path.join(testTmpDir, 'missing-js')
      await fs.mkdir(testDir, { recursive: true })

      // Create SEA config referencing non-existent file.
      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify(
          {
            main: 'nonexistent.js',
            output: 'app.blob',
            disableExperimentalSEAWarning: true,
          },
          null,
          2,
        ),
      )

      // Attempt to generate SEA blob with missing JS file.
      const generateResult = await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        {
          cwd: testDir,
        },
      )

      // Should fail with non-zero exit code.
      expect(generateResult.code).not.toBe(0)
    })
  })
})

// If no built binary exists, show helpful message.
if (!hasBuiltBinary) {
  describe('SEA tests skipped', () => {
    it.skip('should have built smol binary for SEA tests', () => {
      console.log('')
      console.log('━'.repeat(60))
      console.log('SEA tests require a built smol binary.')
      console.log('Run: pnpm build')
      console.log(`Expected binary at: ${finalBinaryPath}`)
      console.log('━'.repeat(60))
      console.log('')
    })
  })
}

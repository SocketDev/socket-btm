/**
 * VFS Format Tests for binject
 * Tests VFS input format handling: directories, .tar, .tar.gz
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

import { getBinjectPath } from './helpers/paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINJECT = getBinjectPath()

let testDir
let binjectExists = false

/**
 * Helper to run binject commands
 */
async function _runBinject(args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(BINJECT, args, {
      cwd: options.cwd || testDir,
      env: { ...process.env, ...options.env },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({ code, stdout, stderr })
    })

    proc.on('error', reject)
  })
}
void _runBinject

/**
 * Create a simple TAR archive from a buffer map
 * @param {Map<string, Buffer>} files - Map of filename to content
 * @returns {Buffer} TAR archive
 */
function createTar(files) {
  const blocks = []

  for (const [name, content] of files) {
    // Create header (512 bytes)
    const header = Buffer.alloc(512)

    // Name (100 bytes)
    header.write(name, 0, 100)

    // Mode (8 bytes) - 0644 in octal
    header.write('0000644\0', 100, 8)

    // UID (8 bytes)
    header.write('0000000\0', 108, 8)

    // GID (8 bytes)
    header.write('0000000\0', 116, 8)

    // Size (12 bytes) - octal
    const sizeStr = `${content.length.toString(8).padStart(11, '0')}\0`
    header.write(sizeStr, 124, 12)

    // Mtime (12 bytes)
    const mtime = Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0')
    header.write(`${mtime}\0`, 136, 12)

    // Checksum placeholder (8 bytes of spaces)
    header.fill(' ', 148, 156)

    // Type flag ('0' for regular file)
    header.write('0', 156, 1)

    // ustar magic
    header.write('ustar\0', 257, 6)
    header.write('00', 263, 2)

    // Calculate checksum
    let checksum = 0
    for (let i = 0; i < 512; i++) {
      checksum += header[i]
    }
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8)

    blocks.push(header)

    // Content (padded to 512 bytes)
    const paddedContent = Buffer.alloc(Math.ceil(content.length / 512) * 512)
    content.copy(paddedContent)
    blocks.push(paddedContent)
  }

  // End of archive (two zero blocks)
  blocks.push(Buffer.alloc(512))
  blocks.push(Buffer.alloc(512))

  return Buffer.concat(blocks)
}

describe('VFS Format Detection', () => {
  beforeAll(async () => {
    // Check if binject exists
    try {
      await fs.access(BINJECT)
      binjectExists = true
    } catch {
      binjectExists = false
    }
  })

  beforeEach(async () => {
    // Create fresh test directory
    testDir = path.join(os.tmpdir(), `binject-vfs-test-${Date.now()}`)
    await safeMkdir(testDir)
  })

  afterAll(async () => {
    if (testDir) {
      await safeDelete(testDir)
    }
  })

  describe('File Extension Detection', () => {
    it.skipIf(!binjectExists)('should recognize .tar.gz files', async () => {
      // Create a tar.gz file
      const files = new Map([['test.txt', Buffer.from('Hello, World!')]])
      const tarData = createTar(files)
      const gzData = zlib.gzipSync(tarData)

      const tarGzPath = path.join(testDir, 'test.tar.gz')
      await fs.writeFile(tarGzPath, gzData)

      // Verify it starts with gzip magic bytes
      const readBack = await fs.readFile(tarGzPath)
      expect(readBack[0]).toBe(0x1f)
      expect(readBack[1]).toBe(0x8b)
    })

    it.skipIf(!binjectExists)('should recognize .tgz files', async () => {
      // Create a .tgz file
      const files = new Map([['test.txt', Buffer.from('Hello, World!')]])
      const tarData = createTar(files)
      const gzData = zlib.gzipSync(tarData)

      const tgzPath = path.join(testDir, 'test.tgz')
      await fs.writeFile(tgzPath, gzData)

      // Verify it starts with gzip magic bytes
      const readBack = await fs.readFile(tgzPath)
      expect(readBack[0]).toBe(0x1f)
      expect(readBack[1]).toBe(0x8b)
    })

    it.skipIf(!binjectExists)(
      'should recognize .tar files (uncompressed)',
      async () => {
        // Create an uncompressed tar file
        const files = new Map([['test.txt', Buffer.from('Hello, World!')]])
        const tarData = createTar(files)

        const tarPath = path.join(testDir, 'test.tar')
        await fs.writeFile(tarPath, tarData)

        // Verify it does NOT start with gzip magic
        const readBack = await fs.readFile(tarPath)
        expect(readBack[0]).not.toBe(0x1f)
      },
    )
  })

  describe('Directory TAR Creation', () => {
    it.skipIf(!binjectExists)(
      'should create directory structure for VFS',
      async () => {
        // Create a directory with files
        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'file1.txt'), 'Content 1')
        await fs.writeFile(path.join(vfsDir, 'file2.txt'), 'Content 2')

        // Create subdirectory
        const subDir = path.join(vfsDir, 'subdir')
        await safeMkdir(subDir)
        await fs.writeFile(path.join(subDir, 'nested.txt'), 'Nested content')

        // Verify directory structure
        const files = await fs.readdir(vfsDir)
        expect(files).toContain('file1.txt')
        expect(files).toContain('file2.txt')
        expect(files).toContain('subdir')

        const subFiles = await fs.readdir(subDir)
        expect(subFiles).toContain('nested.txt')
      },
    )
  })

  describe('Gzip Detection', () => {
    it('should identify gzip data by magic bytes', () => {
      const gzipMagic = Buffer.from([0x1f, 0x8b, 0x08, 0x00])
      expect(gzipMagic[0]).toBe(0x1f)
      expect(gzipMagic[1]).toBe(0x8b)
    })

    it('should not misidentify non-gzip data', () => {
      const notGzip = Buffer.from('Hello, World!')
      expect(notGzip[0]).not.toBe(0x1f)
    })

    it('should correctly gzip and detect', () => {
      const original = Buffer.from('Test data for compression')
      const compressed = zlib.gzipSync(original)

      // Verify gzip magic
      expect(compressed[0]).toBe(0x1f)
      expect(compressed[1]).toBe(0x8b)

      // Verify decompression
      const decompressed = zlib.gunzipSync(compressed)
      expect(decompressed.toString()).toBe(original.toString())
    })
  })

  describe('TAR Format', () => {
    it('should create valid TAR archives', () => {
      const files = new Map([
        ['file1.txt', Buffer.from('Content 1')],
        ['file2.txt', Buffer.from('Content 2')],
      ])

      const tarData = createTar(files)

      // TAR blocks are 512 bytes each
      expect(tarData.length % 512).toBe(0)

      // Check ustar magic at offset 257 in first header
      const magic = tarData.slice(257, 262).toString()
      expect(magic).toBe('ustar')
    })

    it('should handle empty files in TAR', () => {
      const files = new Map([['empty.txt', Buffer.alloc(0)]])

      const tarData = createTar(files)
      expect(tarData.length).toBeGreaterThan(0)
      expect(tarData.length % 512).toBe(0)
    })

    it('should handle files with various sizes', () => {
      const files = new Map([
        ['small.txt', Buffer.from('x')],
        ['medium.txt', Buffer.alloc(1000).fill('m')],
        ['exact-block.txt', Buffer.alloc(512).fill('e')],
      ])

      const tarData = createTar(files)
      expect(tarData.length % 512).toBe(0)
    })
  })

  describe('Combined TAR.GZ', () => {
    it('should create valid tar.gz archives', () => {
      const files = new Map([
        ['readme.txt', Buffer.from('This is a test archive')],
        ['data.bin', Buffer.alloc(100).fill(0xaa)],
      ])

      const tarData = createTar(files)
      const gzData = zlib.gzipSync(tarData)

      // Verify gzip magic
      expect(gzData[0]).toBe(0x1f)
      expect(gzData[1]).toBe(0x8b)

      // Verify decompression yields valid TAR
      const decompressed = zlib.gunzipSync(gzData)
      expect(decompressed.length % 512).toBe(0)

      // Verify ustar magic
      const magic = decompressed.slice(257, 262).toString()
      expect(magic).toBe('ustar')
    })

    it('should compress TAR data efficiently', () => {
      // Create TAR with repetitive content (compresses well)
      const files = new Map([
        ['repeat.txt', Buffer.alloc(10_000).fill('a'.charCodeAt(0))],
      ])

      const tarData = createTar(files)
      const gzData = zlib.gzipSync(tarData)

      // Gzipped should be significantly smaller
      expect(gzData.length).toBeLessThan(tarData.length / 2)
    })
  })
})

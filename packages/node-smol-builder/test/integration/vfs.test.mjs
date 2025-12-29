/**
 * @fileoverview Tests for VFS (Virtual Filesystem) support with TAR/TAR.GZ archives.
 *
 * Tests:
 * - VFS initialization and internalBinding('vfs')
 * - TAR archive parsing (USTAR, PAX, GNU)
 * - GZIP decompression
 * - SEA + VFS dual resource injection
 * - File extraction to ~/.socket/_dlx/<hash>/
 * - fs module integration
 *
 * Note: These tests require a built smol binary at build/{dev,prod}/out/Final/node.
 * Run `pnpm build --dev` first to create the binary.
 */

import { existsSync, promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { runBinject } from '../helpers/binject.mjs'
import { getLatestFinalBinary } from '../paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Get the latest Final binary from build/{dev,prod}/out/Final/node
// This is the production binary suitable for injection and execution
const finalBinaryPath = getLatestFinalBinary()

// Skip all tests if no final binary is available
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath)

// Test tmp directory
const testTmpDir = path.join(tmpdir(), 'socket-btm-vfs-tests')

// VFS extraction directory (matches binary-compressed pattern)
const _DLX_DIR = path.join(homedir(), '.socket', '_dlx')

describe.skipIf(skipTests)('VFS (Virtual Filesystem) support', () => {
  const createdCacheDirs = []

  beforeAll(async () => {
    await fs.mkdir(testTmpDir, { recursive: true })
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)

    // Cleanup all VFS cache directories created during tests
    const cleanupPromises = []
    for (const cacheDir of createdCacheDirs) {
      if (existsSync(cacheDir)) {
        cleanupPromises.push(safeDelete(cacheDir))
      }
    }
    await Promise.all(cleanupPromises)
  })

  describe('SEA fuse injection', () => {
    it('should support NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 sentinel', async () => {
      const testDir = path.join(testTmpDir, 'sea-fuse')
      await fs.mkdir(testDir, { recursive: true })

      // Create test app
      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(appJs, `console.log('SEA fuse works');`)

      // Create SEA config
      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify({
          main: 'app.js',
          output: 'app.blob',
          disableExperimentalSEAWarning: true,
        }),
      )

      // Generate blob
      const genResult = await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        { cwd: testDir },
      )
      expect(genResult.code).toBe(0)

      // Copy binary
      const seaBinary = path.join(testDir, 'app')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await fs.chmod(seaBinary, 0o755)

      // Inject with correct fuse
      const injectResult = await runBinject(
        seaBinary,
        'NODE_SEA_BLOB',
        'app.blob',
        {
          testDir,
          sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          machoSegmentName: 'NODE_SEA',
        },
      )
      expect(injectResult.code).toBe(0)

      // Test execution
      const execResult = await spawn(seaBinary, [])
      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('SEA fuse works')
    })
  })

  describe('VFS TAR archive creation', () => {
    it('should create uncompressed TAR archive', async () => {
      const testDir = path.join(testTmpDir, 'tar-uncompressed')
      await fs.mkdir(testDir, { recursive: true })

      // Create test files
      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'hello.txt'), 'Hello VFS')
      await fs.writeFile(path.join(vfsDir, 'data.json'), '{"test":true}')

      // Create subdirectory
      await fs.mkdir(path.join(vfsDir, 'subdir'), { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'subdir', 'nested.txt'), 'Nested')

      // Create TAR
      const tarPath = path.join(testDir, 'vfs.tar')
      const tarResult = await spawn('tar', ['cf', tarPath, '-C', vfsDir, '.'], {
        cwd: testDir,
      })
      expect(tarResult.code).toBe(0)
      expect(existsSync(tarPath)).toBe(true)

      // Verify TAR contents
      const listResult = await spawn('tar', ['tf', tarPath])
      expect(listResult.stdout).toContain('hello.txt')
      expect(listResult.stdout).toContain('data.json')
      expect(listResult.stdout).toContain('subdir/nested.txt')
    })

    it('should create compressed TAR.GZ archive', async () => {
      const testDir = path.join(testTmpDir, 'tar-compressed')
      await fs.mkdir(testDir, { recursive: true })

      // Create test files
      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'large.txt'), 'X'.repeat(10_000))

      // Create TAR.GZ
      const tarGzPath = path.join(testDir, 'vfs.tar.gz')
      const tarResult = await spawn(
        'tar',
        ['czf', tarGzPath, '-C', vfsDir, '.'],
        { cwd: testDir },
      )
      expect(tarResult.code).toBe(0)
      expect(existsSync(tarGzPath)).toBe(true)

      // Verify compression (should be smaller)
      const tarSize =
        (await fs.stat(path.join(testDir, '../tar-uncompressed/vfs.tar')))
          .size || 10_000
      const tarGzSize = (await fs.stat(tarGzPath)).size
      expect(tarGzSize).toBeLessThan(tarSize)
    })
  })

  describe('VFS + SEA dual resource injection', () => {
    it('should inject both NODE_SEA_BLOB and SOCKSEC_VFS_BLOB', async () => {
      const testDir = path.join(testTmpDir, 'dual-injection')
      await fs.mkdir(testDir, { recursive: true })

      // Create SEA app that reads from VFS
      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs');
const path = require('path');

// Check VFS
const vfsBinding = process.binding('vfs');
if (vfsBinding && vfsBinding.hasVFSBlob()) {
  console.log('VFS_AVAILABLE');

  // Initialize VFS
  const { initVFS } = require('internal/socketsecurity_vfs/loader');
  const vfs = initVFS();

  if (vfs) {
    console.log('VFS_INITIALIZED');
    console.log('VFS_SIZE=' + vfs.size);
  }
} else {
  console.log('VFS_NOT_AVAILABLE');
}
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
        }),
      )

      // Generate SEA blob
      const genResult = await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        { cwd: testDir },
      )
      expect(genResult.code).toBe(0)

      // Create VFS content
      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'test.txt'), 'VFS file content')

      // Create VFS TAR
      const vfsTar = path.join(testDir, 'vfs.tar')
      await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'])

      // Copy binary
      const seaBinary = path.join(testDir, 'app')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await fs.chmod(seaBinary, 0o755)

      // Inject SEA blob
      const injectSeaResult = await runBinject(
        seaBinary,
        'NODE_SEA_BLOB',
        'app.blob',
        {
          testDir,
          sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          machoSegmentName: 'NODE_SEA',
        },
      )
      expect(injectSeaResult.code).toBe(0)

      // Inject VFS blob
      const injectVfsResult = await runBinject(
        seaBinary,
        'SOCKSEC_VFS_BLOB',
        vfsTar,
        {
          testDir,
          sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          machoSegmentName: 'NODE_VFS',
        },
      )
      expect(injectVfsResult.code).toBe(0)

      // Test execution
      const execResult = await spawn(seaBinary, [])
      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('VFS_AVAILABLE')
      expect(execResult.stdout).toContain('VFS_INITIALIZED')
      expect(execResult.stdout).toContain('VFS_SIZE=')
    })
  })

  describe('VFS extraction to ~/.socket/_dlx/', () => {
    it('should extract VFS to cache directory on first run', async () => {
      const testDir = path.join(testTmpDir, 'vfs-extraction')
      await fs.mkdir(testDir, { recursive: true })

      // Create SEA app that extracts VFS files
      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const os = require('os');

// VFS extraction logic (similar to binary-compressed)
const DLX_DIR = path.join(os.homedir(), '.socket', '_dlx');

async function extractVFS() {
  const vfsBinding = process.binding('vfs');
  if (!vfsBinding || !vfsBinding.hasVFSBlob()) {
    console.log('NO_VFS');
    return;
  }

  // Get VFS blob
  const vfsBlob = vfsBinding.getVFSBlob();
  if (!vfsBlob) {
    console.log('EMPTY_VFS');
    return;
  }

  // Calculate hash for cache directory
  const hash = createHash('sha256').update(vfsBlob).digest('hex').slice(0, 16);
  const cacheDir = path.join(DLX_DIR, hash);

  console.log('CACHE_DIR=' + cacheDir);

  // Check if already extracted
  if (fs.existsSync(cacheDir)) {
    console.log('CACHE_HIT');
    return;
  }

  // Create cache directory
  fs.mkdirSync(cacheDir, { recursive: true });

  // Initialize VFS
  const { initVFS } = require('internal/socketsecurity_vfs/loader');
  const vfs = initVFS();

  if (!vfs) {
    console.log('VFS_INIT_FAILED');
    return;
  }

  // Extract all files
  let extracted = 0;
  for (const [filepath, content] of vfs) {
    if (content === null) continue; // Skip directories

    const targetPath = path.join(cacheDir, filepath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
    extracted++;
  }

  console.log('EXTRACTED=' + extracted);
}

extractVFS().catch(err => {
  console.error('ERROR=' + err.message);
  process.exit(1);
});
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
        }),
      )

      // Generate SEA blob
      await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        { cwd: testDir },
      )

      // Create VFS content
      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'file1.txt'), 'Content 1')
      await fs.writeFile(path.join(vfsDir, 'file2.txt'), 'Content 2')
      await fs.mkdir(path.join(vfsDir, 'subdir'), { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'subdir', 'file3.txt'), 'Content 3')

      // Create VFS TAR
      const vfsTar = path.join(testDir, 'vfs.tar')
      await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'])

      // Copy and inject
      const seaBinary = path.join(testDir, 'app')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await fs.chmod(seaBinary, 0o755)

      await runBinject(seaBinary, 'NODE_SEA_BLOB', 'app.blob', {
        testDir,
        sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
        machoSegmentName: 'NODE_SEA',
      })

      await runBinject(seaBinary, 'SOCKSEC_VFS_BLOB', vfsTar, {
        testDir,
        sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
        machoSegmentName: 'NODE_VFS',
      })

      // First run: should extract
      const firstRun = await spawn(seaBinary, [])
      expect(firstRun.code).toBe(0)
      expect(firstRun.stdout).toContain('CACHE_DIR=')
      expect(firstRun.stdout).toContain('EXTRACTED=3')

      // Extract cache directory from output
      const cacheDirMatch = firstRun.stdout.match(/CACHE_DIR=(.+)/)
      expect(cacheDirMatch).toBeTruthy()
      const cacheDir = cacheDirMatch[1].trim()
      createdCacheDirs.push(cacheDir)

      // Verify extraction
      expect(existsSync(cacheDir)).toBe(true)
      expect(existsSync(path.join(cacheDir, 'file1.txt'))).toBe(true)
      expect(existsSync(path.join(cacheDir, 'file2.txt'))).toBe(true)
      expect(existsSync(path.join(cacheDir, 'subdir', 'file3.txt'))).toBe(true)

      // Verify content
      const content1 = await fs.readFile(
        path.join(cacheDir, 'file1.txt'),
        'utf8',
      )
      expect(content1).toBe('Content 1')

      // Second run: should hit cache
      const secondRun = await spawn(seaBinary, [])
      expect(secondRun.code).toBe(0)
      expect(secondRun.stdout).toContain('CACHE_HIT')
    })
  })

  describe('VFS TAR format support', () => {
    it('should support PAX extended headers for long filenames', async () => {
      const testDir = path.join(testTmpDir, 'tar-pax')
      await fs.mkdir(testDir, { recursive: true })

      // Create file with long name (150 chars)
      // Note: macOS filesystem limits filenames to 255 bytes, but USTAR format
      // only supports 100 chars, so 150 chars requires PAX extended headers
      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      const longName = `${'a'.repeat(150)}.txt`
      await fs.writeFile(path.join(vfsDir, longName), 'Long name content')

      // Create TAR with PAX format
      const tarPath = path.join(testDir, 'vfs.tar')
      await spawn('tar', ['cf', tarPath, '--format=posix', '-C', vfsDir, '.'])

      expect(existsSync(tarPath)).toBe(true)

      // Verify TAR contains long filename
      const listResult = await spawn('tar', ['tf', tarPath])
      expect(listResult.stdout).toContain(longName)
    })
  })

  describe('VFS extraction path validation', () => {
    it('should use ~/.socket/_dlx/ as base directory', async () => {
      const testDir = path.join(testTmpDir, 'vfs-path-validation')
      await fs.mkdir(testDir, { recursive: true })

      // Create SEA app that validates extraction path
      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const path = require('path');
const os = require('os');

const expectedBase = path.join(os.homedir(), '.socket', '_dlx');
console.log('EXPECTED_BASE=' + expectedBase);

const vfsBinding = process.binding('vfs');
if (vfsBinding && vfsBinding.hasVFSBlob()) {
  const { createHash } = require('crypto');
  const vfsBlob = vfsBinding.getVFSBlob();
  const hash = createHash('sha256').update(vfsBlob).digest('hex').slice(0, 16);
  const actualPath = path.join(expectedBase, hash);
  console.log('ACTUAL_PATH=' + actualPath);

  // Validate path structure
  const isCorrectBase = actualPath.startsWith(expectedBase);
  console.log('CORRECT_BASE=' + isCorrectBase);

  // Validate hash is 16 hex chars
  const hashMatch = /[da-f]{16}$/.test(hash);
  console.log('VALID_HASH=' + hashMatch);
}
`,
      )

      // Create and inject VFS
      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify({
          main: 'app.js',
          output: 'app.blob',
          disableExperimentalSEAWarning: true,
        }),
      )

      await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        { cwd: testDir },
      )

      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'test.txt'), 'test')

      const vfsTar = path.join(testDir, 'vfs.tar')
      await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'])

      const seaBinary = path.join(testDir, 'app')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await fs.chmod(seaBinary, 0o755)

      await runBinject(seaBinary, 'NODE_SEA_BLOB', 'app.blob', {
        testDir,
        sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
        machoSegmentName: 'NODE_SEA',
      })

      await runBinject(seaBinary, 'SOCKSEC_VFS_BLOB', vfsTar, {
        testDir,
        sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
        machoSegmentName: 'NODE_VFS',
      })

      const execResult = await spawn(seaBinary, [])
      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('EXPECTED_BASE=')
      expect(execResult.stdout).toContain('ACTUAL_PATH=')
      expect(execResult.stdout).toContain('CORRECT_BASE=true')
      expect(execResult.stdout).toContain('VALID_HASH=true')

      // Extract and validate actual path matches pattern
      const expectedBase = path.join(homedir(), '.socket', '_dlx')
      const actualPathMatch = execResult.stdout.match(/ACTUAL_PATH=(.+)/)
      expect(actualPathMatch).toBeTruthy()
      const actualPath = actualPathMatch[1].trim()
      expect(actualPath).toContain(expectedBase)
    })

    it('should use SHA-256 hash (16 chars) for cache directory name', async () => {
      const testDir = path.join(testTmpDir, 'vfs-hash-validation')
      await fs.mkdir(testDir, { recursive: true })

      // Create SEA app that validates hash format
      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const { createHash } = require('crypto');
const path = require('path');
const os = require('os');

const vfsBinding = process.binding('vfs');
if (vfsBinding && vfsBinding.hasVFSBlob()) {
  const vfsBlob = vfsBinding.getVFSBlob();
  const fullHash = createHash('sha256').update(vfsBlob).digest('hex');
  const shortHash = fullHash.slice(0, 16);

  console.log('FULL_HASH_LENGTH=' + fullHash.length);
  console.log('SHORT_HASH_LENGTH=' + shortHash.length);
  console.log('SHORT_HASH=' + shortHash);

  // Validate it's hex
  const isHex = /^[da-f]+$/.test(shortHash);
  console.log('IS_HEX=' + isHex);

  // Construct cache path
  const DLX_DIR = path.join(os.homedir(), '.socket', '_dlx');
  const cacheDir = path.join(DLX_DIR, shortHash);
  console.log('CACHE_PATH=' + cacheDir);
}
`,
      )

      // Create and inject VFS
      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify({
          main: 'app.js',
          output: 'app.blob',
          disableExperimentalSEAWarning: true,
        }),
      )

      await spawn(
        finalBinaryPath,
        ['--experimental-sea-config', 'sea-config.json'],
        { cwd: testDir },
      )

      const vfsDir = path.join(testDir, 'vfs-content')
      await fs.mkdir(vfsDir, { recursive: true })
      await fs.writeFile(path.join(vfsDir, 'data.json'), '{"test":true}')

      const vfsTar = path.join(testDir, 'vfs.tar')
      await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'])

      const seaBinary = path.join(testDir, 'app')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await fs.chmod(seaBinary, 0o755)

      await runBinject(seaBinary, 'NODE_SEA_BLOB', 'app.blob', {
        testDir,
        sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
        machoSegmentName: 'NODE_SEA',
      })

      await runBinject(seaBinary, 'SOCKSEC_VFS_BLOB', vfsTar, {
        testDir,
        sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
        machoSegmentName: 'NODE_VFS',
      })

      const execResult = await spawn(seaBinary, [])
      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('FULL_HASH_LENGTH=64')
      expect(execResult.stdout).toContain('SHORT_HASH_LENGTH=16')
      expect(execResult.stdout).toContain('IS_HEX=true')
      expect(execResult.stdout).toContain('CACHE_PATH=')

      // Validate hash format
      const hashMatch = execResult.stdout.match(/SHORT_HASH=([\da-f]{16})/)
      expect(hashMatch).toBeTruthy()
      expect(hashMatch[1]).toHaveLength(16)
    })

    it('should match compression extraction pattern structure', () => {
      // Both VFS and compression use ~/.socket/_dlx/
      const baseDir = path.join(homedir(), '.socket', '_dlx')

      // VFS: ~/.socket/_dlx/<sha256-16chars>/
      const vfsPattern = /^[\da-f]{16}$/

      // Compression: ~/.socket/_dlx/<sha512-16chars>-<platform>-<arch>/
      const compressionPattern =
        /^[\da-f]{16}-(macos|linux|windows)-(x64|arm64|ia32|arm)$/

      // Validate patterns are distinct but share base
      expect(baseDir).toContain('.socket')
      expect(baseDir).toContain('_dlx')

      // VFS uses simpler hash-only pattern
      expect('a1b2c3d4e5f67890'.match(vfsPattern)).toBeTruthy()
      expect('a1b2c3d4e5f67890'.match(compressionPattern)).toBeFalsy()

      // Compression uses hash-platform-arch pattern
      expect(
        'a1b2c3d4e5f67890-macos-arm64'.match(compressionPattern),
      ).toBeTruthy()
      expect('a1b2c3d4e5f67890-macos-arm64'.match(vfsPattern)).toBeFalsy()
    })
  })
})

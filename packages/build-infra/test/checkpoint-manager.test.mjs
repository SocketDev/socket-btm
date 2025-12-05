/**
 * @fileoverview Tests for checkpoint-manager utilities.
 */

import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { which } from '@socketsecurity/lib/bin'
import { toUnixPath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  cleanCheckpoint,
  createCheckpoint,
  getCheckpointData,
  hasCheckpoint,
  listCheckpoints,
  removeCheckpoint,
  shouldRun,
} from '../lib/checkpoint-manager.mjs'

describe('checkpoint-manager', () => {
  let testBuildDir

  beforeEach(async () => {
    // Create unique temp directory for each test
    const tmpBase = path.join(tmpdir(), 'checkpoint-test')
    testBuildDir = path.join(
      tmpBase,
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    await fs.mkdir(testBuildDir, { recursive: true })
  })

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testBuildDir)) {
      await fs.rm(testBuildDir, { recursive: true, force: true })
    }
  })

  describe('hasCheckpoint', () => {
    it('should return false for non-existent checkpoint', async () => {
      const exists = await hasCheckpoint(
        testBuildDir,
        'test-pkg',
        'non-existent',
      )
      expect(exists).toBe(false)
    })

    it('should return true for existing checkpoint', async () => {
      await createCheckpoint(testBuildDir, 'exists', async () => {}, {
        packageName: 'test-pkg',
      })
      const exists = await hasCheckpoint(testBuildDir, 'test-pkg', 'exists')
      expect(exists).toBe(true)
    })
  })

  describe('createCheckpoint', () => {
    it('should create checkpoint file', async () => {
      await createCheckpoint(testBuildDir, 'test-checkpoint', async () => {}, {
        packageName: 'test-pkg',
      })

      const checkpointPath = path.join(
        testBuildDir,
        'checkpoints',
        'test-pkg',
        'test-checkpoint.json',
      )
      expect(existsSync(checkpointPath)).toBe(true)
    })

    it('should create checkpoint with metadata', async () => {
      const metadata = { foo: 'bar', num: 123 }
      await createCheckpoint(testBuildDir, 'test-checkpoint', async () => {}, {
        packageName: 'test-pkg',
        ...metadata,
      })

      const data = await getCheckpointData(
        testBuildDir,
        'test-pkg',
        'test-checkpoint',
      )
      expect(data.foo).toBe('bar')
      expect(data.num).toBe(123)
      expect(data.name).toBe('test-checkpoint')
      expect(data.created).toBeDefined()
    })

    it('should create nested checkpoint directories', async () => {
      await createCheckpoint(testBuildDir, 'checkpoint', async () => {}, {
        packageName: 'nested/pkg/name',
      })

      const checkpointPath = path.join(
        testBuildDir,
        'checkpoints',
        'nested/pkg/name',
        'checkpoint.json',
      )
      expect(existsSync(checkpointPath)).toBe(true)
    })
  })

  describe('getCheckpointData', () => {
    it('should return null for non-existent checkpoint', async () => {
      const data = await getCheckpointData(
        testBuildDir,
        'test-pkg',
        'non-existent',
      )
      expect(data).toBeNull()
    })

    it('should return checkpoint data', async () => {
      const metadata = { version: '1.0.0', hash: 'abc123' }
      await createCheckpoint(testBuildDir, 'checkpoint', async () => {}, {
        packageName: 'test-pkg',
        ...metadata,
      })

      const data = await getCheckpointData(
        testBuildDir,
        'test-pkg',
        'checkpoint',
      )
      expect(data.version).toBe('1.0.0')
      expect(data.hash).toBe('abc123')
      expect(data.name).toBe('checkpoint')
    })
  })

  describe('listCheckpoints', () => {
    it('should return empty array for package with no checkpoints', async () => {
      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toEqual([])
    })

    it('should list all checkpoints for package', async () => {
      await createCheckpoint(testBuildDir, 'checkpoint-1', async () => {}, {
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'checkpoint-2', async () => {}, {
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'checkpoint-3', async () => {}, {
        packageName: 'test-pkg',
      })

      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toHaveLength(3)
      expect(checkpoints).toContain('checkpoint-1')
      expect(checkpoints).toContain('checkpoint-2')
      expect(checkpoints).toContain('checkpoint-3')
    })

    it('should return sorted checkpoint names', async () => {
      await createCheckpoint(testBuildDir, 'zebra', async () => {}, {
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'alpha', async () => {}, {
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'beta', async () => {}, {
        packageName: 'test-pkg',
      })

      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toEqual(['alpha', 'beta', 'zebra'])
    })
  })

  describe('removeCheckpoint', () => {
    it('should remove specific checkpoint', async () => {
      await createCheckpoint(testBuildDir, 'keep', async () => {}, {
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'remove', async () => {}, {
        packageName: 'test-pkg',
      })

      await removeCheckpoint(testBuildDir, 'test-pkg', 'remove')

      const hasRemoved = await hasCheckpoint(testBuildDir, 'test-pkg', 'remove')
      const hasKept = await hasCheckpoint(testBuildDir, 'test-pkg', 'keep')
      expect(hasRemoved).toBe(false)
      expect(hasKept).toBe(true)
    })

    it('should not throw on non-existent checkpoint', async () => {
      await expect(
        removeCheckpoint(testBuildDir, 'test-pkg', 'non-existent'),
      ).resolves.toBeUndefined()
    })
  })

  describe('cleanCheckpoint', () => {
    it('should remove all checkpoints for package', async () => {
      await createCheckpoint(testBuildDir, 'checkpoint-1', async () => {}, {
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'checkpoint-2', async () => {}, {
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'checkpoint-3', async () => {}, {
        packageName: 'test-pkg',
      })

      await cleanCheckpoint(testBuildDir, 'test-pkg')

      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toEqual([])
    })

    it('should not affect other packages', async () => {
      await createCheckpoint(testBuildDir, 'checkpoint', async () => {}, {
        packageName: 'pkg-1',
      })
      await createCheckpoint(testBuildDir, 'checkpoint', async () => {}, {
        packageName: 'pkg-2',
      })

      await cleanCheckpoint(testBuildDir, 'pkg-1')

      const pkg1Checkpoints = await listCheckpoints(testBuildDir, 'pkg-1')
      const pkg2Checkpoints = await listCheckpoints(testBuildDir, 'pkg-2')
      expect(pkg1Checkpoints).toEqual([])
      expect(pkg2Checkpoints).toEqual(['checkpoint'])
    })
  })

  describe('shouldRun', () => {
    it('should return true when checkpoint does not exist', async () => {
      const result = await shouldRun(
        testBuildDir,
        'test-pkg',
        'new-checkpoint',
        false,
      )
      expect(result).toBe(true)
    })

    it('should return false when checkpoint exists', async () => {
      await createCheckpoint(testBuildDir, 'existing', async () => {}, {
        packageName: 'test-pkg',
      })
      const result = await shouldRun(
        testBuildDir,
        'test-pkg',
        'existing',
        false,
      )
      expect(result).toBe(false)
    })

    it('should return true when force flag is set', async () => {
      await createCheckpoint(testBuildDir, 'existing', async () => {}, {
        packageName: 'test-pkg',
      })
      const result = await shouldRun(testBuildDir, 'test-pkg', 'existing', true)
      expect(result).toBe(true)
    })

    it('should return true when force flag is set even without checkpoint', async () => {
      const result = await shouldRun(
        testBuildDir,
        'test-pkg',
        'non-existent',
        true,
      )
      expect(result).toBe(true)
    })
  })

  describe('build mode isolation', () => {
    it('should isolate checkpoints by build directory', async () => {
      const devBuildDir = path.join(testBuildDir, 'dev')
      const prodBuildDir = path.join(testBuildDir, 'prod')

      await fs.mkdir(devBuildDir, { recursive: true })
      await fs.mkdir(prodBuildDir, { recursive: true })

      // Create checkpoints in different build directories
      await createCheckpoint(devBuildDir, 'checkpoint', async () => {}, {
        packageName: 'test-pkg',
      })
      await createCheckpoint(prodBuildDir, 'checkpoint', async () => {}, {
        packageName: 'test-pkg',
      })

      // Both should exist independently
      const devHas = await hasCheckpoint(devBuildDir, 'test-pkg', 'checkpoint')
      const prodHas = await hasCheckpoint(
        prodBuildDir,
        'test-pkg',
        'checkpoint',
      )
      expect(devHas).toBe(true)
      expect(prodHas).toBe(true)

      // Clean one should not affect the other
      await cleanCheckpoint(devBuildDir, 'test-pkg')

      const devHasAfter = await hasCheckpoint(
        devBuildDir,
        'test-pkg',
        'checkpoint',
      )
      const prodHasAfter = await hasCheckpoint(
        prodBuildDir,
        'test-pkg',
        'checkpoint',
      )
      expect(devHasAfter).toBe(false)
      expect(prodHasAfter).toBe(true)
    })
  })

  describe('checkpoint extraction structure', () => {
    it('should extract directory checkpoints with --strip-components=1', async () => {
      // Create a checkpoint with a directory structure
      const artifactDir = path.join(testBuildDir, 'out', 'Final')
      const testFile = path.join(artifactDir, 'test-artifact.txt')
      await fs.mkdir(artifactDir, { recursive: true })
      await fs.writeFile(testFile, 'test content')

      // Create checkpoint with directory as artifactPath
      await createCheckpoint(
        testBuildDir,
        'finalized',
        async () => {
          // Smoke test
        },
        {
          packageName: 'test-pkg',
          artifactPath: artifactDir,
        },
      )

      // Simulate extraction: extract checkpoint and verify structure
      // Tarball is in checkpoints/{packageName}/{checkpointName}.tar.gz
      const checkpointFile = path.join(
        testBuildDir,
        'checkpoints',
        'test-pkg',
        'finalized.tar.gz',
      )
      expect(existsSync(checkpointFile)).toBe(true)

      // Extract to a new location (simulating CI restore)
      const extractDir = path.join(testBuildDir, 'restored', 'out', 'Final')
      await fs.mkdir(extractDir, { recursive: true })

      // Extract with --strip-components=1 (as done in restore-checkpoint action)
      const tarPath = await which('tar', { nothrow: true })
      if (!tarPath) {
        // Skip test if tar not available
        return
      }

      // Convert paths to Unix-style for Git's tar on Windows
      const unixCheckpointFile = toUnixPath(checkpointFile)
      const unixExtractDir = toUnixPath(extractDir)

      await spawn(tarPath, [
        '-xzf',
        unixCheckpointFile,
        '-C',
        unixExtractDir,
        '--strip-components=1',
      ])

      // Verify files are in correct location (NOT double-nested)
      const restoredFile = path.join(extractDir, 'test-artifact.txt')
      const doubleNestedFile = path.join(
        extractDir,
        'Final',
        'test-artifact.txt',
      )

      // Should exist at top level of extractDir
      expect(existsSync(restoredFile)).toBe(true)
      // Should NOT exist in double-nested location
      expect(existsSync(doubleNestedFile)).toBe(false)

      const content = await fs.readFile(restoredFile, 'utf8')
      expect(content).toBe('test content')
    })

    it('should handle nested subdirectories correctly', async () => {
      // Create checkpoint with deeper nesting
      const artifactDir = path.join(testBuildDir, 'out', 'Compiled')
      const nestedFile = path.join(artifactDir, 'subdir', 'nested.wasm')
      await fs.mkdir(path.dirname(nestedFile), { recursive: true })
      await fs.writeFile(nestedFile, 'wasm content')

      await createCheckpoint(testBuildDir, 'wasm-compiled', async () => {}, {
        packageName: 'test-pkg',
        artifactPath: artifactDir,
      })

      // Extract with --strip-components=1
      const checkpointFile = path.join(
        testBuildDir,
        'checkpoints',
        'test-pkg',
        'wasm-compiled.tar.gz',
      )
      const extractDir = path.join(testBuildDir, 'restored', 'out', 'Compiled')
      await fs.mkdir(extractDir, { recursive: true })

      const tarPath = await which('tar', { nothrow: true })
      if (!tarPath) {
        // Skip test if tar not available
        return
      }

      // Convert paths to Unix-style for Git's tar on Windows
      const unixCheckpointFile = toUnixPath(checkpointFile)
      const unixExtractDir = toUnixPath(extractDir)

      await spawn(tarPath, [
        '-xzf',
        unixCheckpointFile,
        '-C',
        unixExtractDir,
        '--strip-components=1',
      ])

      // Verify nested structure is preserved (minus top-level directory)
      const restoredFile = path.join(extractDir, 'subdir', 'nested.wasm')
      expect(existsSync(restoredFile)).toBe(true)

      const content = await fs.readFile(restoredFile, 'utf8')
      expect(content).toBe('wasm content')
    })

    it('should handle single file in directory checkpoint', async () => {
      // Create checkpoint with single file (like node-smol binaries)
      const artifactDir = path.join(testBuildDir, 'out', 'Compressed')
      const binaryFile = path.join(artifactDir, 'node')
      await fs.mkdir(artifactDir, { recursive: true })
      await fs.writeFile(binaryFile, 'binary content')

      // Create checkpoint with directory as artifactPath (NOT the file)
      await createCheckpoint(
        testBuildDir,
        'binary-compressed',
        async () => {},
        {
          packageName: 'test-pkg',
          artifactPath: artifactDir,
        },
      )

      // Extract with --strip-components=1
      const checkpointFile = path.join(
        testBuildDir,
        'checkpoints',
        'test-pkg',
        'binary-compressed.tar.gz',
      )
      const extractDir = path.join(
        testBuildDir,
        'restored',
        'out',
        'Compressed',
      )
      await fs.mkdir(extractDir, { recursive: true })

      const tarPath = await which('tar', { nothrow: true })
      if (!tarPath) {
        // Skip test if tar not available
        return
      }

      // Convert paths to Unix-style for Git's tar on Windows
      const unixCheckpointFile = toUnixPath(checkpointFile)
      const unixExtractDir = toUnixPath(extractDir)

      await spawn(tarPath, [
        '-xzf',
        unixCheckpointFile,
        '-C',
        unixExtractDir,
        '--strip-components=1',
      ])

      // Verify file is in correct location
      const restoredFile = path.join(extractDir, 'node')
      expect(existsSync(restoredFile)).toBe(true)

      const content = await fs.readFile(restoredFile, 'utf8')
      expect(content).toBe('binary content')
    })
  })
})

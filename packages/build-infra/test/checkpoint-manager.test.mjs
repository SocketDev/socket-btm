/**
 * @fileoverview Tests for checkpoint-manager utilities.
 */

import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
      await createCheckpoint(testBuildDir, 'test-pkg', 'exists', async () => {})
      const exists = await hasCheckpoint(testBuildDir, 'test-pkg', 'exists')
      expect(exists).toBe(true)
    })
  })

  describe('createCheckpoint', () => {
    it('should create checkpoint file', async () => {
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'test-checkpoint',
        async () => {},
      )

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
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'test-checkpoint',
        async () => {},
        metadata,
      )

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
      await createCheckpoint(
        testBuildDir,
        'nested/pkg/name',
        'checkpoint',
        async () => {},
      )

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
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'checkpoint',
        async () => {},
        metadata,
      )

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
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'checkpoint-1',
        async () => {},
      )
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'checkpoint-2',
        async () => {},
      )
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'checkpoint-3',
        async () => {},
      )

      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toHaveLength(3)
      expect(checkpoints).toContain('checkpoint-1')
      expect(checkpoints).toContain('checkpoint-2')
      expect(checkpoints).toContain('checkpoint-3')
    })

    it('should return sorted checkpoint names', async () => {
      await createCheckpoint(testBuildDir, 'test-pkg', 'zebra', async () => {})
      await createCheckpoint(testBuildDir, 'test-pkg', 'alpha', async () => {})
      await createCheckpoint(testBuildDir, 'test-pkg', 'beta', async () => {})

      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toEqual(['alpha', 'beta', 'zebra'])
    })
  })

  describe('removeCheckpoint', () => {
    it('should remove specific checkpoint', async () => {
      await createCheckpoint(testBuildDir, 'test-pkg', 'keep', async () => {})
      await createCheckpoint(testBuildDir, 'test-pkg', 'remove', async () => {})

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
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'checkpoint-1',
        async () => {},
      )
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'checkpoint-2',
        async () => {},
      )
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'checkpoint-3',
        async () => {},
      )

      await cleanCheckpoint(testBuildDir, 'test-pkg')

      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toEqual([])
    })

    it('should not affect other packages', async () => {
      await createCheckpoint(
        testBuildDir,
        'pkg-1',
        'checkpoint',
        async () => {},
      )
      await createCheckpoint(
        testBuildDir,
        'pkg-2',
        'checkpoint',
        async () => {},
      )

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
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'existing',
        async () => {},
      )
      const result = await shouldRun(
        testBuildDir,
        'test-pkg',
        'existing',
        false,
      )
      expect(result).toBe(false)
    })

    it('should return true when force flag is set', async () => {
      await createCheckpoint(
        testBuildDir,
        'test-pkg',
        'existing',
        async () => {},
      )
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
      await createCheckpoint(
        devBuildDir,
        'test-pkg',
        'checkpoint',
        async () => {},
      )
      await createCheckpoint(
        prodBuildDir,
        'test-pkg',
        'checkpoint',
        async () => {},
      )

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
})

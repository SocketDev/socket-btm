import { afterEach, beforeEach, describe, expect, it } from 'vitest'
/**
 * @file Tests for checkpoint-manager utilities.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'

import {
  cleanCheckpoint,
  createCheckpoint,
  getCheckpointData,
  hasCheckpoint,
  listCheckpoints,
  removeCheckpoint,
  shouldRun,
} from '../lib/checkpoint-manager.mts'

// Binary-stage checkpoints require explicit {platform, arch}; these tests
// exercise the checkpoint machinery generically, so any concrete target works.
const TARGET = { platform: 'linux', arch: 'x64' } as const

describe('checkpoint-manager', () => {
  let testBuildDir: string

  beforeEach(async () => {
    // Create unique temp directory for each test
    const tmpBase = path.join(os.tmpdir(), 'checkpoint-test')
    testBuildDir = path.join(
      tmpBase,
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    await safeMkdir(testBuildDir)
  })

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testBuildDir)) {
      await safeDelete(testBuildDir)
    }
  })

  describe(hasCheckpoint, () => {
    it('should return false for non-existent checkpoint', async () => {
      const exists = await hasCheckpoint(
        testBuildDir,
        'test-pkg',
        'non-existent',
      )
      expect(exists).toBeFalsy()
    })

    it('should return true for existing checkpoint', async () => {
      await createCheckpoint(testBuildDir, 'exists', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })
      const exists = await hasCheckpoint(testBuildDir, 'test-pkg', 'exists')
      expect(exists).toBeTruthy()
    })
  })

  describe(createCheckpoint, () => {
    it('should create checkpoint file', async () => {
      await createCheckpoint(testBuildDir, 'test-checkpoint', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })

      const checkpointPath = path.join(
        testBuildDir,
        'checkpoints',
        'test-pkg',
        'test-checkpoint.json',
      )
      expect(existsSync(checkpointPath)).toBeTruthy()
    })

    it('should create checkpoint with metadata', async () => {
      const metadata = { foo: 'bar', num: 123 }
      await createCheckpoint(testBuildDir, 'test-checkpoint', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
        ...metadata,
      })

      const data = await getCheckpointData(
        testBuildDir,
        'test-pkg',
        'test-checkpoint',
      )
      expect(data?.['foo']).toBe('bar')
      expect(data?.['num']).toBe(123)
      expect(data?.name).toBe('test-checkpoint')
      expect(data?.created).toBeDefined()
    })

    it('should create nested checkpoint directories', async () => {
      await createCheckpoint(testBuildDir, 'checkpoint', async () => {}, {
        ...TARGET,
        packageName: 'nested/pkg/name',
      })

      const checkpointPath = path.join(
        testBuildDir,
        'checkpoints',
        'nested/pkg/name',
        'checkpoint.json',
      )
      expect(existsSync(checkpointPath)).toBeTruthy()
    })
  })

  describe(getCheckpointData, () => {
    it('should return undefined for non-existent checkpoint', async () => {
      const data = await getCheckpointData(
        testBuildDir,
        'test-pkg',
        'non-existent',
      )
      expect(data).toBeUndefined()
    })

    it('should return checkpoint data', async () => {
      const metadata = { hash: 'abc123', version: '1.0.0' }
      await createCheckpoint(testBuildDir, 'checkpoint', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
        ...metadata,
      })

      const data = await getCheckpointData(
        testBuildDir,
        'test-pkg',
        'checkpoint',
      )
      expect(data?.['version']).toBe('1.0.0')
      expect(data?.['hash']).toBe('abc123')
      expect(data?.name).toBe('checkpoint')
    })
  })

  describe(listCheckpoints, () => {
    it('should return empty array for package with no checkpoints', async () => {
      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toStrictEqual([])
    })

    it('should list all checkpoints for package', async () => {
      await createCheckpoint(testBuildDir, 'checkpoint-1', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'checkpoint-2', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'checkpoint-3', async () => {}, {
        ...TARGET,
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
        ...TARGET,
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'alpha', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'beta', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })

      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toEqual(['alpha', 'beta', 'zebra'])
    })
  })

  describe(removeCheckpoint, () => {
    it('should remove specific checkpoint', async () => {
      await createCheckpoint(testBuildDir, 'keep', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'remove', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })

      await removeCheckpoint(testBuildDir, 'test-pkg', 'remove')

      const hasRemoved = await hasCheckpoint(testBuildDir, 'test-pkg', 'remove')
      const hasKept = await hasCheckpoint(testBuildDir, 'test-pkg', 'keep')
      expect(hasRemoved).toBeFalsy()
      expect(hasKept).toBeTruthy()
    })

    it('should not throw on non-existent checkpoint', async () => {
      await expect(
        removeCheckpoint(testBuildDir, 'test-pkg', 'non-existent'),
      ).resolves.toBeUndefined()
    })
  })

  describe(cleanCheckpoint, () => {
    it('should remove all checkpoints for package', async () => {
      await createCheckpoint(testBuildDir, 'checkpoint-1', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'checkpoint-2', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })
      await createCheckpoint(testBuildDir, 'checkpoint-3', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })

      await cleanCheckpoint(testBuildDir, 'test-pkg')

      const checkpoints = await listCheckpoints(testBuildDir, 'test-pkg')
      expect(checkpoints).toStrictEqual([])
    })

    it('should not affect other packages', async () => {
      await createCheckpoint(testBuildDir, 'checkpoint', async () => {}, {
        ...TARGET,
        packageName: 'pkg-1',
      })
      await createCheckpoint(testBuildDir, 'checkpoint', async () => {}, {
        ...TARGET,
        packageName: 'pkg-2',
      })

      await cleanCheckpoint(testBuildDir, 'pkg-1')

      const pkg1Checkpoints = await listCheckpoints(testBuildDir, 'pkg-1')
      const pkg2Checkpoints = await listCheckpoints(testBuildDir, 'pkg-2')
      expect(pkg1Checkpoints).toEqual([])
      expect(pkg2Checkpoints).toEqual(['checkpoint'])
    })
  })

  describe(shouldRun, () => {
    it('should return true when checkpoint does not exist', async () => {
      const result = await shouldRun(
        testBuildDir,
        'test-pkg',
        'new-checkpoint',
        false,
      )
      expect(result).toBeTruthy()
    })

    it('should return false when checkpoint exists', async () => {
      await createCheckpoint(testBuildDir, 'existing', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })
      const result = await shouldRun(
        testBuildDir,
        'test-pkg',
        'existing',
        false,
      )
      expect(result).toBeFalsy()
    })

    it('should return true when force flag is set', async () => {
      await createCheckpoint(testBuildDir, 'existing', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })
      const result = await shouldRun(testBuildDir, 'test-pkg', 'existing', true)
      expect(result).toBeTruthy()
    })

    it('should return true when force flag is set even without checkpoint', async () => {
      const result = await shouldRun(
        testBuildDir,
        'test-pkg',
        'non-existent',
        true,
      )
      expect(result).toBeTruthy()
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
        ...TARGET,
        packageName: 'test-pkg',
      })
      await createCheckpoint(prodBuildDir, 'checkpoint', async () => {}, {
        ...TARGET,
        packageName: 'test-pkg',
      })

      // Both should exist independently
      const devHas = await hasCheckpoint(devBuildDir, 'test-pkg', 'checkpoint')
      const prodHas = await hasCheckpoint(
        prodBuildDir,
        'test-pkg',
        'checkpoint',
      )
      expect(devHas).toBeTruthy()
      expect(prodHas).toBeTruthy()

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
      expect(devHasAfter).toBeFalsy()
      expect(prodHasAfter).toBeTruthy()
    })
  })
})

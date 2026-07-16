import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * @file Tests for checkpoint tarball extraction structure.
 *   Verifies that --strip-components=1 extraction produces the correct
 *   directory layout. Split from checkpoint-manager.test.mts.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { which } from '@socketsecurity/lib-stable/bin/which'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { toUnixPath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { createCheckpoint } from '../lib/checkpoint-manager.mts'
import { CHECKPOINTS } from '../lib/constants.mts'

const TARGET = { platform: 'linux', arch: 'x64' } as const

describe('checkpoint extraction structure', () => {
  let testBuildDir: string

  beforeEach(async () => {
    const tmpBase = path.join(os.tmpdir(), 'checkpoint-test')
    testBuildDir = path.join(
      tmpBase,
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    await safeMkdir(testBuildDir)
  })

  afterEach(async () => {
    if (existsSync(testBuildDir)) {
      await safeDelete(testBuildDir)
    }
  })

  it('should extract directory checkpoints with --strip-components=1', async () => {
    // Create a checkpoint with a directory structure
    const artifactDir = path.join(testBuildDir, 'out', 'Final')
    const testFile = path.join(artifactDir, 'test-artifact.txt')
    await fs.mkdir(artifactDir, { recursive: true })
    await fs.writeFile(testFile, 'test content')

    // Create checkpoint with directory as artifactPath
    await createCheckpoint(
      testBuildDir,
      CHECKPOINTS.FINALIZED,
      async () => {
        // Smoke test
      },
      {
        ...TARGET,
        artifactPath: artifactDir,
        packageName: 'test-pkg',
      },
    )

    // Simulate extraction: extract checkpoint and verify structure
    // Tarball is in checkpoints/{packageName}/{checkpointName}.tar.gz
    const checkpointFile = path.join(
      testBuildDir,
      'checkpoints',
      'test-pkg',
      `${CHECKPOINTS.FINALIZED}.tar.gz`,
    )
    expect(existsSync(checkpointFile)).toBeTruthy()

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
    const doubleNestedFile = path.join(extractDir, 'Final', 'test-artifact.txt')

    // Should exist at top level of extractDir
    expect(existsSync(restoredFile)).toBeTruthy()
    // Should NOT exist in double-nested location
    expect(existsSync(doubleNestedFile)).toBeFalsy()

    const content = await fs.readFile(restoredFile, 'utf8')
    expect(content).toBe('test content')
  })

  it('should handle nested subdirectories correctly', async () => {
    // Create checkpoint with deeper nesting
    const artifactDir = path.join(testBuildDir, 'out', 'Compiled')
    const nestedFile = path.join(artifactDir, 'subdir', 'nested.wasm')
    await fs.mkdir(path.dirname(nestedFile), { recursive: true })
    await fs.writeFile(nestedFile, 'wasm content')

    await createCheckpoint(
      testBuildDir,
      CHECKPOINTS.WASM_COMPILED,
      async () => {},
      {
        ...TARGET,
        artifactPath: artifactDir,
        packageName: 'test-pkg',
      },
    )

    // Extract with --strip-components=1
    const checkpointFile = path.join(
      testBuildDir,
      'checkpoints',
      'test-pkg',
      `${CHECKPOINTS.WASM_COMPILED}.tar.gz`,
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
    expect(existsSync(restoredFile)).toBeTruthy()

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
      CHECKPOINTS.BINARY_COMPRESSED,
      async () => {},
      {
        ...TARGET,
        artifactPath: artifactDir,
        packageName: 'test-pkg',
      },
    )

    // Extract with --strip-components=1
    const checkpointFile = path.join(
      testBuildDir,
      'checkpoints',
      'test-pkg',
      `${CHECKPOINTS.BINARY_COMPRESSED}.tar.gz`,
    )
    const extractDir = path.join(testBuildDir, 'restored', 'out', 'Compressed')
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
    expect(existsSync(restoredFile)).toBeTruthy()

    const content = await fs.readFile(restoredFile, 'utf8')
    expect(content).toBe('binary content')
  })
})

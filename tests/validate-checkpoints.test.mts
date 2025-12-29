/**
 * @fileoverview Unit tests for checkpoint validation logic.
 *
 * Tests the core validation logic used by .github/actions/validate-depot-checkpoints
 * to ensure checkpoint archives are properly validated before caching.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib/fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { validateCheckpoints } from './validate-checkpoints.mts'

// Test environment setup.
let testDir: string

beforeEach(() => {
  // Create unique test directory for each test.
  testDir = path.join(
    os.tmpdir(),
    `checkpoint-validation-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  )
  mkdirSync(testDir, { recursive: true })
})

afterEach(async () => {
  // Cleanup test directory after each test.
  try {
    await safeDelete(testDir)
  } catch {
    // Ignore cleanup errors.
  }
})

// Helper functions.
/**
 * Creates a valid tar archive for testing.
 */
function createValidTar(tarPath: string): void {
  const contentDir = path.join(
    os.tmpdir(),
    `tar-content-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  )
  mkdirSync(contentDir, { recursive: true })

  const testFile = path.join(contentDir, 'test.txt')
  writeFileSync(testFile, 'test content')

  const result = spawnSync(
    'tar',
    ['-cf', tarPath, '-C', contentDir, 'test.txt'],
    {
      encoding: 'utf8',
      stdio: 'pipe',
    },
  )

  if (result.status !== 0) {
    throw new Error(`Failed to create tar archive: ${result.stderr}`)
  }
  // Note: Temporary directory cleanup will be handled by afterEach.
}

/**
 * Creates a valid compressed tar.gz archive for testing.
 */
function createValidTarGz(tarPath: string): void {
  const contentDir = path.join(
    os.tmpdir(),
    `tar-content-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  )
  mkdirSync(contentDir, { recursive: true })

  const testFile = path.join(contentDir, 'test.txt')
  writeFileSync(testFile, 'test content')

  const result = spawnSync(
    'tar',
    ['-czf', tarPath, '-C', contentDir, 'test.txt'],
    {
      encoding: 'utf8',
      stdio: 'pipe',
    },
  )

  if (result.status !== 0) {
    throw new Error(`Failed to create tar.gz archive: ${result.stderr}`)
  }
  // Note: Temporary directory cleanup will be handled by afterEach.
}

/**
 * Creates a corrupted tar archive for testing.
 */
function createCorruptedTar(tarPath: string): void {
  writeFileSync(tarPath, 'not a valid tar archive')
}

/**
 * Creates test package structure.
 */
function createTestPackage(packageName: string): string {
  const packagePath = path.join(testDir, 'packages', packageName)
  mkdirSync(packagePath, { recursive: true })
  return packagePath
}

// =============================================================================
// Test Suite: No Directories
// =============================================================================

describe('No checkpoint directories', () => {
  it('should return checkpointsFound=false when no directories exist', () => {
    const packagePath = createTestPackage('test-pkg')

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(false)
    expect(result.valid).toBe(false)
    expect(result.message).toBe('No checkpoint directories found')
    expect(result.checkpointCount).toBe(0)
    expect(result.corruptedCount).toBe(0)
  })
})

// =============================================================================
// Test Suite: Empty Directories
// =============================================================================

describe('Empty checkpoint directories', () => {
  it('should return valid=false when directories exist but are empty', () => {
    const packagePath = createTestPackage('test-pkg')
    mkdirSync(path.join(packagePath, 'build', 'prod', 'checkpoints'), {
      recursive: true,
    })
    mkdirSync(path.join(packagePath, 'build', 'shared', 'checkpoints'), {
      recursive: true,
    })

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.message).toBe('No checkpoint archives found')
    expect(result.checkpointCount).toBe(0)
    expect(result.corruptedCount).toBe(0)
  })
})

// =============================================================================
// Test Suite: Valid Checkpoints
// =============================================================================

describe('Valid checkpoints', () => {
  it('should validate single .tar checkpoint', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    createValidTar(path.join(checkpointDir, 'stage1.tar'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.message).toBe('All checkpoints valid')
    expect(result.checkpointCount).toBe(1)
    expect(result.corruptedCount).toBe(0)
  })

  it('should validate single .tar.gz checkpoint', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    createValidTarGz(path.join(checkpointDir, 'stage1.tar.gz'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.message).toBe('All checkpoints valid')
    expect(result.checkpointCount).toBe(1)
    expect(result.corruptedCount).toBe(0)
  })

  it('should validate single .tgz checkpoint', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    createValidTarGz(path.join(checkpointDir, 'stage1.tgz'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.message).toBe('All checkpoints valid')
    expect(result.checkpointCount).toBe(1)
    expect(result.corruptedCount).toBe(0)
  })

  it('should validate multiple checkpoints', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    createValidTar(path.join(checkpointDir, 'stage1.tar'))
    createValidTar(path.join(checkpointDir, 'stage2.tar'))
    createValidTar(path.join(checkpointDir, 'stage3.tar'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.message).toBe('All checkpoints valid')
    expect(result.checkpointCount).toBe(3)
    expect(result.corruptedCount).toBe(0)
  })
})

// =============================================================================
// Test Suite: Corrupted Checkpoints
// =============================================================================

describe('Corrupted checkpoints', () => {
  it('should detect single corrupted checkpoint', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    createCorruptedTar(path.join(checkpointDir, 'stage1.tar'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.message).toBe('Corrupted checkpoints detected')
    expect(result.checkpointCount).toBe(1)
    expect(result.corruptedCount).toBe(1)
  })

  it('should detect mixed valid and corrupted checkpoints', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    createValidTar(path.join(checkpointDir, 'stage1.tar'))
    createCorruptedTar(path.join(checkpointDir, 'stage2.tar'))
    createValidTar(path.join(checkpointDir, 'stage3.tar'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.message).toBe('Corrupted checkpoints detected')
    expect(result.checkpointCount).toBe(3)
    expect(result.corruptedCount).toBe(1)
  })

  it('should detect empty tar archives', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    // Create an empty but valid tar archive.
    const emptyTar = path.join(checkpointDir, 'empty.tar')
    spawnSync('tar', ['-cf', emptyTar, '-T', '/dev/null'], { stdio: 'pipe' })

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.message).toBe('Corrupted checkpoints detected')
    expect(result.checkpointCount).toBe(1)
    expect(result.corruptedCount).toBe(1)
  })
})

// =============================================================================
// Test Suite: Build Modes
// =============================================================================

describe('Build modes', () => {
  it('should validate dev mode checkpoints', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'dev', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    createValidTar(path.join(checkpointDir, 'stage1.tar'))

    const result = validateCheckpoints({
      buildMode: 'dev',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.message).toBe('All checkpoints valid')
    expect(result.checkpointCount).toBe(1)
    expect(result.corruptedCount).toBe(0)
  })

  it('should validate prod mode checkpoints', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    createValidTar(path.join(checkpointDir, 'stage1.tar'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.message).toBe('All checkpoints valid')
    expect(result.checkpointCount).toBe(1)
    expect(result.corruptedCount).toBe(0)
  })
})

// =============================================================================
// Test Suite: Shared Checkpoints
// =============================================================================

describe('Shared checkpoints', () => {
  it('should validate shared checkpoints only', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(
      packagePath,
      'build',
      'shared',
      'checkpoints',
    )
    mkdirSync(checkpointDir, { recursive: true })

    createValidTar(path.join(checkpointDir, 'base.tar'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.message).toBe('All checkpoints valid')
    expect(result.checkpointCount).toBe(1)
    expect(result.corruptedCount).toBe(0)
  })

  it('should validate both mode-specific and shared checkpoints', () => {
    const packagePath = createTestPackage('test-pkg')
    const prodDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    const sharedDir = path.join(packagePath, 'build', 'shared', 'checkpoints')
    mkdirSync(prodDir, { recursive: true })
    mkdirSync(sharedDir, { recursive: true })

    createValidTar(path.join(prodDir, 'stage1.tar'))
    createValidTar(path.join(sharedDir, 'base.tar'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.message).toBe('All checkpoints valid')
    expect(result.checkpointCount).toBe(2)
    expect(result.corruptedCount).toBe(0)
  })

  it('should detect corrupted shared checkpoint', () => {
    const packagePath = createTestPackage('test-pkg')
    const prodDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    const sharedDir = path.join(packagePath, 'build', 'shared', 'checkpoints')
    mkdirSync(prodDir, { recursive: true })
    mkdirSync(sharedDir, { recursive: true })

    createValidTar(path.join(prodDir, 'stage1.tar'))
    createCorruptedTar(path.join(sharedDir, 'base.tar'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.message).toBe('Corrupted checkpoints detected')
    expect(result.checkpointCount).toBe(2)
    expect(result.corruptedCount).toBe(1)
  })
})

// =============================================================================
// Test Suite: Mixed Archive Formats
// =============================================================================

describe('Mixed archive formats', () => {
  it('should validate checkpoints in different formats', () => {
    const packagePath = createTestPackage('test-pkg')
    const checkpointDir = path.join(packagePath, 'build', 'prod', 'checkpoints')
    mkdirSync(checkpointDir, { recursive: true })

    createValidTar(path.join(checkpointDir, 'stage1.tar'))
    createValidTarGz(path.join(checkpointDir, 'stage2.tar.gz'))
    createValidTarGz(path.join(checkpointDir, 'stage3.tgz'))

    const result = validateCheckpoints({
      buildMode: 'prod',
      packageName: 'test-pkg',
      packagePath,
    })

    expect(result.checkpointsFound).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.message).toBe('All checkpoints valid')
    expect(result.checkpointCount).toBe(3)
    expect(result.corruptedCount).toBe(0)
  })
})

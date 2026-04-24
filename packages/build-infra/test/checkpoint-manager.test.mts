/**
 * @fileoverview Tests for checkpoint-manager utilities.
 */

import { existsSync, promises as fs } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { which } from '@socketsecurity/lib/bin'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
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
} from '../lib/checkpoint-manager.mts'
import { CHECKPOINTS } from '../lib/constants.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')

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
      expect(data.foo).toBe('bar')
      expect(data.num).toBe(123)
      expect(data.name).toBe('test-checkpoint')
      expect(data.created).toBeDefined()
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
      expect(data.version).toBe('1.0.0')
      expect(data.hash).toBe('abc123')
      expect(data.name).toBe('checkpoint')
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
      const doubleNestedFile = path.join(
        extractDir,
        'Final',
        'test-artifact.txt',
      )

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
      expect(existsSync(restoredFile)).toBeTruthy()

      const content = await fs.readFile(restoredFile, 'utf8')
      expect(content).toBe('binary content')
    })
  })
})

/**
 * Recursively find all .mts files in a directory
 */
async function findMjsFiles(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    // Skip node_modules and test directories
    if (entry.name === 'node_modules' || entry.name.includes('.test.')) {
      continue
    }

    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      await findMjsFiles(fullPath, files)
    } else if (entry.name.endsWith('.mts')) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Check if a createCheckpoint call uses the correct signature
 */
function validateCreateCheckpointCall(fileContent, filePath) {
  const lines = fileContent.split('\n')
  const errors = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Find createCheckpoint calls
    if (
      line.includes('createCheckpoint(') &&
      (line.includes('await') || line.trim().startsWith('createCheckpoint('))
    ) {
      // Get context (next 10 lines)
      const context = lines.slice(i, Math.min(i + 10, lines.length)).join('\n')

      // Check 1: Must have a third parameter that's either an inline async
      // callback OR a referenced identifier (variable / property access).
      // Accepts:
      //   createCheckpoint(dir, 'name', async () => {}, {})         inline arrow
      //   createCheckpoint(dir, 'name', async function () {}, {})   inline function
      //   createCheckpoint(dir, 'name', smokeTest, {})              variable reference
      //   createCheckpoint(dir, 'name', helpers.smoke, {})          property access
      const hasAsyncCallback =
        /async\s*\(\s*\)\s*=>/.test(context) ||
        /async\s*\(\s*\)/.test(context) ||
        /async\s*function/.test(context)

      // Third positional param in the form `createCheckpoint(arg1, arg2, ident...`.
      // We want to allow identifiers / property accesses (but not string literals
      // — a string in position 3 means position 2 was probably the checkpoint
      // name and the signature is an old one).
      const identifierThirdParam =
        /createCheckpoint\(\s*[^,]+,\s*[^,]+,\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*[,)]/.test(
          context,
        )

      if (!hasAsyncCallback && !identifierThirdParam) {
        errors.push({
          context: lines.slice(i, Math.min(i + 5, lines.length)).join('\n'),
          error:
            'Third parameter must be an inline async callback or a callback ' +
            'identifier/property-access (e.g. smokeTest or ctx.smoke)',
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
        })
        continue
      }

      // Check 2: Second parameter should be a string literal (checkpoint name), not a variable like "packageName"
      // Get the lines that contain the parameters
      const paramLines = []
      let braceCount = 0
      let foundStart = false

      for (let j = i; j < Math.min(i + 15, lines.length); j++) {
        const paramLine = lines[j]
        if (paramLine.includes('createCheckpoint(')) {
          foundStart = true
        }
        if (foundStart) {
          paramLines.push(paramLine)
          braceCount += (paramLine.match(/\(/g) || []).length
          braceCount -= (paramLine.match(/\)/g) || []).length

          if (braceCount === 0 && foundStart) {
            break
          }
        }
      }

      const fullCall = paramLines.join('\n')

      // Pattern: createCheckpoint(buildDir, packageName, 'checkpoint-name', async () => ...)
      // This is WRONG - packageName should not be a positional parameter
      const badPattern = /createCheckpoint\([^,]+,\s*packageName\s*,/
      if (badPattern.test(fullCall)) {
        errors.push({
          context: fullCall.substring(0, 200),
          error:
            'Using old signature with packageName as second positional parameter',
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
        })
      }

      // Pattern: createCheckpoint(buildDir, '', 'checkpoint-name', ...)
      // This is WRONG - empty string should not be a positional parameter
      const emptyStringPattern = /createCheckpoint\([^,]+,\s*['"]{2}\s*,/
      if (emptyStringPattern.test(fullCall)) {
        errors.push({
          context: fullCall.substring(0, 200),
          error:
            'Using old signature with empty string as second positional parameter',
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
        })
      }
    }
  }

  return errors
}

describe('createCheckpoint signature validation', () => {
  it('should validate all createCheckpoint calls use correct signature', async () => {
    const packagesDir = path.join(REPO_ROOT, 'packages')

    if (!existsSync(packagesDir)) {
      console.log('Skipping: packages directory not found')
      return
    }

    // Find all .mts files
    const files = await findMjsFiles(packagesDir)

    // Filter to only script files (not tests)
    const scriptFiles = files.filter(
      f =>
        !f.includes('/test/') &&
        !f.includes('.test.') &&
        !f.includes('node_modules'),
    )

    console.log(`Validating ${scriptFiles.length} script files...`)

    // Validate each file
    const allErrors = []

    for (const file of scriptFiles) {
      // eslint-disable-next-line no-await-in-loop
      const content = await readFile(file, 'utf8')
      const errors = validateCreateCheckpointCall(content, file)
      allErrors.push(...errors)
    }

    // Report errors
    if (allErrors.length > 0) {
      console.error('\n❌ Found createCheckpoint signature errors:\n')
      for (const error of allErrors) {
        console.error(`\n${error.file}:${error.line}`)
        console.error(`  Error: ${error.error}`)
        console.error(`  Context:\n${error.context}\n`)
      }

      expect(allErrors).toHaveLength(0)
    } else {
      console.log(`✓ All ${scriptFiles.length} files validated successfully`)
    }
  })

  it('should verify correct signature pattern', () => {
    const correctExample = `
      await createCheckpoint(
        buildDir,
        'checkpoint-name',
        async () => {
          // smoke test
        },
        {
          packageName: 'optional',
          artifactPath: '/path/to/artifact'
        }
      )
    `

    const errors = validateCreateCheckpointCall(correctExample, 'test.mts')
    expect(errors).toStrictEqual([])
  })

  it('should detect old signature with packageName as positional param', () => {
    const wrongExample = `
      await createCheckpoint(
        buildDir,
        packageName,
        'checkpoint-name',
        async () => {
          // smoke test
        }
      )
    `

    const errors = validateCreateCheckpointCall(wrongExample, 'test.mts')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].error).toContain('old signature')
  })

  it('should detect old signature with empty string', () => {
    const wrongExample = `
      await createCheckpoint(
        buildDir,
        '',
        'checkpoint-name',
        async () => {
          // smoke test
        }
      )
    `

    const errors = validateCreateCheckpointCall(wrongExample, 'test.mts')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].error).toContain('empty string')
  })
})

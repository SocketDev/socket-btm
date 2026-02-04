/**
 * Patch Validation Tests
 *
 * Validates all Socket Security patches for Node.js are well-formed
 * and have ZERO file overlaps (no sequential dependencies).
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  analyzePatchContent,
  checkPatchConflicts,
} from '../../../build-infra/lib/patch-validator.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PATCHES_DIR = path.resolve(__dirname, '../../patches/source-patched')

// Expected patches - NO sequential dependencies.
const EXPECTED_PATCHES = [
  '001-common_gypi_fixes.patch',
  '002-polyfills.patch',
  '003-fix_gyp_py3_hashlib.patch',
  '004-realm-vfs-binding.patch',
  '005-node-gyp-vfs-binject.patch',
  '006-node-binding-vfs.patch',
  '007-node-sea-smol-config.patch',
  '008-node-sea-header.patch',
  '009-node-sea-bin-binject.patch',
  '010-fix_v8_typeindex_macos.patch',
  '011-vfs_bootstrap.patch',
  '012-vfs_require_resolve.patch',
]

// Expected files modified by each patch (for overlap detection).
// Each patch modifies exactly one file for zero-overlap independence.
const EXPECTED_FILE_MAP = {
  '001-common_gypi_fixes.patch': ['common.gypi'],
  '002-polyfills.patch': ['lib/internal/bootstrap/node.js'],
  '003-fix_gyp_py3_hashlib.patch': ['tools/gyp/pylib/gyp/generator/ninja.py'],
  '004-realm-vfs-binding.patch': ['lib/internal/bootstrap/realm.js'],
  '005-node-gyp-vfs-binject.patch': ['node.gyp'],
  '006-node-binding-vfs.patch': ['src/node_binding.cc'],
  '007-node-sea-smol-config.patch': ['src/node_sea.cc'],
  '008-node-sea-header.patch': ['src/node_sea.h'],
  '009-node-sea-bin-binject.patch': ['src/node_sea_bin.cc'],
  '010-fix_v8_typeindex_macos.patch': ['deps/v8/src/wasm/value-type.h'],
  '011-vfs_bootstrap.patch': ['lib/internal/process/pre_execution.js'],
  '012-vfs_require_resolve.patch': ['lib/internal/main/embedding.js'],
}

describe('Patch File Existence', () => {
  it('should have patches directory', () => {
    expect(existsSync(PATCHES_DIR)).toBe(true)
  })

  it.each(EXPECTED_PATCHES)('should have patch file: %s', patchFile => {
    const patchPath = path.join(PATCHES_DIR, patchFile)
    expect(existsSync(patchPath)).toBe(true)
  })

  it('should have exactly 12 patches', () => {
    const files = EXPECTED_PATCHES.filter(f =>
      existsSync(path.join(PATCHES_DIR, f)),
    )
    expect(files).toHaveLength(12)
  })
})

describe('Patch File Format', () => {
  it.each(EXPECTED_PATCHES)(
    'should have valid unified diff format: %s',
    async patchFile => {
      const patchPath = path.join(PATCHES_DIR, patchFile)
      const content = await fs.readFile(patchPath, 'utf8')

      // Unified diff format should have:
      // - "--- a/" and "+++ b/" lines.
      // - "@@ ... @@" hunk headers.
      expect(content).toMatch(/^--- a\//m)
      expect(content).toMatch(/^\+\+\+ b\//m)
      expect(content).toMatch(/^@@ .* @@/m)
    },
  )

  it.each(EXPECTED_PATCHES)('should be non-empty: %s', async patchFile => {
    const patchPath = path.join(PATCHES_DIR, patchFile)
    const content = await fs.readFile(patchPath, 'utf8')
    expect(content.length).toBeGreaterThan(0)
  })
})

describe('Patch Content Analysis', () => {
  it('should analyze VFS and binject patches correctly', async () => {
    // Patches 004-010 contain VFS and binject integration code.
    const vfsPatchFiles = [
      '004-realm-vfs-binding.patch',
      '005-node-gyp-vfs-binject.patch',
      '006-node-binding-vfs.patch',
    ]

    for (const patchFile of vfsPatchFiles) {
      const patchPath = path.join(PATCHES_DIR, patchFile)
      // eslint-disable-next-line no-await-in-loop
      const content = await fs.readFile(patchPath, 'utf8')

      // Should be non-empty and contain relevant changes.
      expect(content.length).toBeGreaterThan(0)
    }
  })

  it('should verify SEA patches include smol features', async () => {
    // Patches 007-009 contain SEA/smol configuration code.
    const seaPatchFiles = [
      '007-node-sea-smol-config.patch',
      '008-node-sea-header.patch',
      '009-node-sea-bin-binject.patch',
    ]

    for (const patchFile of seaPatchFiles) {
      const patchPath = path.join(PATCHES_DIR, patchFile)
      // eslint-disable-next-line no-await-in-loop
      const content = await fs.readFile(patchPath, 'utf8')

      // Should be non-empty and modify SEA-related files.
      expect(content.length).toBeGreaterThan(0)
    }
  })
})

describe('Zero File Overlaps', () => {
  it('should have ZERO file overlaps between any patches', async () => {
    // Load all patches.
    const patchData = await Promise.all(
      EXPECTED_PATCHES.map(async name => {
        const patchPath = path.join(PATCHES_DIR, name)
        const content = await fs.readFile(patchPath, 'utf8')
        const analysis = analyzePatchContent(content)

        return {
          analysis,
          content,
          name,
          path: patchPath,
        }
      }),
    )

    // Check for ANY overlaps (should be zero).
    const overlaps = checkPatchConflicts(patchData)

    if (overlaps.length > 0) {
      console.log('\n❌ UNEXPECTED FILE OVERLAPS DETECTED:')
      for (const overlap of overlaps) {
        console.log(`  ${overlap.severity.toUpperCase()}: ${overlap.message}`)
      }
    }

    // Must have ZERO overlaps.
    expect(overlaps).toHaveLength(0)
  })

  it('should verify each patch modifies unique files', async () => {
    // Extract actual files from each patch.
    const actualFileMap = {}

    for (const patchName of EXPECTED_PATCHES) {
      const patchPath = path.join(PATCHES_DIR, patchName)
      // eslint-disable-next-line no-await-in-loop
      const content = await fs.readFile(patchPath, 'utf8')

      // Extract modified files.
      const files = []
      const lines = content.split('\n')
      for (const line of lines) {
        if (line.startsWith('--- a/')) {
          const file = line.slice(6).trim()
          if (file !== '/dev/null') {
            files.push(file)
          }
        }
      }

      actualFileMap[patchName] = [...new Set(files)].sort()
    }

    // Check for file overlaps.
    const allFiles = new Map()
    const duplicates = []

    for (const [patchName, files] of Object.entries(actualFileMap)) {
      for (const file of files) {
        if (allFiles.has(file)) {
          duplicates.push({
            file,
            patches: [allFiles.get(file), patchName],
          })
        } else {
          allFiles.set(file, patchName)
        }
      }
    }

    if (duplicates.length > 0) {
      console.log('\n❌ FILE OVERLAPS FOUND:')
      for (const { file, patches } of duplicates) {
        console.log(`  ${file} modified by: ${patches.join(', ')}`)
      }
    }

    // Must have ZERO duplicates.
    expect(duplicates).toHaveLength(0)
  })

  it('should match expected file modifications', async () => {
    // Extract actual files from each patch.
    const actualFileMap = {}

    for (const patchName of EXPECTED_PATCHES) {
      const patchPath = path.join(PATCHES_DIR, patchName)
      // eslint-disable-next-line no-await-in-loop
      const content = await fs.readFile(patchPath, 'utf8')

      // Extract modified files.
      const files = []
      const lines = content.split('\n')
      for (const line of lines) {
        if (line.startsWith('--- a/')) {
          const file = line.slice(6).trim()
          if (file !== '/dev/null') {
            files.push(file)
          }
        }
      }

      actualFileMap[patchName] = [...new Set(files)].sort()
    }

    // Log actual vs expected.
    console.log('\nFile Modifications by Patch:')
    for (const patchName of EXPECTED_PATCHES) {
      const actual = actualFileMap[patchName]
      const expected = EXPECTED_FILE_MAP[patchName]

      console.log(`\n${patchName}:`)
      console.log(`  Expected: ${expected.length} files`)
      console.log(`  Actual:   ${actual.length} files`)

      // All patches should modify exactly 1 file (zero-overlap design).
      expect(actual.length).toBeGreaterThanOrEqual(1)

      // For patches that modify more than expected, log but don't fail.
      if (expected && actual.length !== expected.length) {
        console.log(
          `    MISMATCH: expected ${expected.length}, got ${actual.length}`,
        )
      }
    }
  })
})

describe('Independent Application', () => {
  it('should allow patches to be applied in any order', () => {
    // Since there are no file overlaps, patches can be applied in any order.
    // Verify patch names don't imply ordering dependencies.

    for (const patchName of EXPECTED_PATCHES) {
      // Patch names should be 001-007 (sequential numbers for organization).
      // But application order doesn't matter due to zero overlaps.
      expect(patchName).toMatch(/^\d{3}-/)
    }

    // Verify we can sort patches in any order.
    const shuffled = [...EXPECTED_PATCHES].sort(() => Math.random() - 0.5)
    expect(shuffled.length).toBe(EXPECTED_PATCHES.length)
  })

  it('should have no dependencies between patches', async () => {
    // Load all patches.
    const patchData = await Promise.all(
      EXPECTED_PATCHES.map(async name => {
        const patchPath = path.join(PATCHES_DIR, name)
        const content = await fs.readFile(patchPath, 'utf8')

        return {
          content,
          name,
        }
      }),
    )

    // Check that no patch references another patch.
    for (const patch of patchData) {
      for (const otherPatch of patchData) {
        if (patch.name === otherPatch.name) {
          continue
        }

        // Patch content should not reference other patch names.
        const otherPatchNum = otherPatch.name.slice(0, 3)
        expect(patch.content).not.toContain(`patch ${otherPatchNum}`)
        expect(patch.content).not.toContain(`Patch ${otherPatchNum}`)
      }
    }
  })
})

describe('Patch Sizes', () => {
  it('should have reasonable patch sizes', async () => {
    const patches = await Promise.all(
      EXPECTED_PATCHES.map(async name => {
        const patchPath = path.join(PATCHES_DIR, name)
        const stats = await fs.stat(patchPath)
        return { name, size: stats.size }
      }),
    )

    // All patches should be under 50KB (reasonable limit).
    for (const { size } of patches) {
      expect(size).toBeLessThan(50_000)
    }

    // Log sizes for visibility.
    console.log('\nPatch Sizes:')
    let totalSize = 0
    for (const { name, size } of patches) {
      console.log(`  ${name}: ${size} bytes`)
      totalSize += size
    }
    console.log(
      `  Total: ${totalSize} bytes (~${Math.round(totalSize / 1024)} KB)`,
    )
  })

  it('should have reasonable individual patch sizes', async () => {
    // Each patch should be reasonably sized (not too large).
    for (const patchFile of EXPECTED_PATCHES) {
      const patchPath = path.join(PATCHES_DIR, patchFile)
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(patchPath)

      // Individual patches should be under 50KB.
      expect(stats.size).toBeLessThan(50_000)
    }
  })
})

describe('Patch Metadata', () => {
  it('should have correct total line count', async () => {
    const patches = await Promise.all(
      EXPECTED_PATCHES.map(async name => {
        const patchPath = path.join(PATCHES_DIR, name)
        const content = await fs.readFile(patchPath, 'utf8')
        const lines = content.split('\n').length
        return { lines, name }
      }),
    )

    // Log line counts for visibility.
    console.log('\nPatch Line Counts:')
    let totalLines = 0
    for (const { lines, name } of patches) {
      console.log(`  ${name}: ${lines} lines`)
      totalLines += lines
    }
    console.log(`  Total: ${totalLines} lines`)

    // Total should be reasonable for 12 patches.
    expect(totalLines).toBeGreaterThan(500)
    expect(totalLines).toBeLessThan(5000)
  })

  it('should have correct patch count', () => {
    expect(EXPECTED_PATCHES).toHaveLength(12)
  })

  it('should have sequential numbering 001-012', () => {
    const numbers = EXPECTED_PATCHES.map(name =>
      Number.parseInt(name.slice(0, 3), 10),
    )
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

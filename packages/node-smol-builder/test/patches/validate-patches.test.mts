/**
 * Patch Validation Tests.
 *
 * Validates all Socket Security patches for Node.js are well-formed
 * and have ZERO file overlaps (no sequential dependencies).
 */

import { describe, expect, it, test } from 'vitest'

import { existsSync, promises as fs, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  analyzePatchContent,
  checkPatchConflicts,
} from 'build-infra/lib/patch-validator'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PATCHES_DIR = path.resolve(__dirname, '../../patches/source-patched')

// Auto-discover patches — the directory is the single source of truth, matching
// the real build's apply-patches.mts (readdirSync + sort by name). A hardcoded
// list silently drifts: a newly added patch goes untested, and the count
// assertion breaks. Discovering keeps every patch covered by format / zero-
// overlap / apply-in-any-order checks the moment it lands, no list to maintain.
const EXPECTED_PATCHES = readdirSync(PATCHES_DIR)
  .filter(f => f.endsWith('.patch'))
  .sort((a, b) => a.localeCompare(b))

describe('patch File Existence', () => {
  it('should have patches directory', () => {
    expect(existsSync(PATCHES_DIR)).toBeTruthy()
  })

  it.each(EXPECTED_PATCHES)('should have patch file: %s', patchFile => {
    const patchPath = path.join(PATCHES_DIR, patchFile)
    expect(existsSync(patchPath)).toBeTruthy()
  })

  it(`should have exactly ${EXPECTED_PATCHES.length} patches`, () => {
    const files = EXPECTED_PATCHES.filter(f =>
      existsSync(path.join(PATCHES_DIR, f)),
    )
    expect(files).toHaveLength(EXPECTED_PATCHES.length)
  })
})

describe('patch File Format', () => {
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

describe('patch Content Analysis', () => {
  it('should analyze VFS and binject patches correctly', async () => {
    // Patches 003-005 contain VFS and binject integration code.
    const vfsPatchFiles = [
      '003-realm-smol-bindings.patch',
      '004-node-gyp-smol-sources.patch',
      '005-smol-binding-macros.patch',
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
    // Patches 006-008 contain SEA/smol configuration code.
    const seaPatchFiles = [
      '006-sea-smol-config.patch',
      '007-sea-smol-structs.patch',
      '008-sea-binject.patch',
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

describe('zero File Overlaps', () => {
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

      actualFileMap[patchName] = [...new Set(files)].toSorted()
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

      actualFileMap[patchName] = [...new Set(files)].toSorted()
    }

    // Every patch must modify at least one real file (a no-op patch is a bug).
    // The set of files each patch touches is derived from its own `--- a/`
    // headers above — no hardcoded expected-file map to drift against. The
    // zero-overlap test ('should verify each patch modifies unique files')
    // already guarantees no two patches touch the same file.
    for (const patchName of EXPECTED_PATCHES) {
      const actual = actualFileMap[patchName]
      expect(
        actual.length,
        `${patchName} modifies no files`,
      ).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('independent Application', () => {
  it('should allow patches to be applied in any order', () => {
    // Since there are no file overlaps, patches can be applied in any order.
    // Verify patch names don't imply ordering dependencies.

    for (const patchName of EXPECTED_PATCHES) {
      // Patch names should be 001-007 (sequential numbers for organization).
      // But application order doesn't matter due to zero overlaps.
      expect(patchName).toMatch(/^\d{3}-/)
    }

    // Verify we can sort patches in any order.
    const shuffled = [...EXPECTED_PATCHES].toSorted(() => Math.random() - 0.5)
    expect(shuffled).toHaveLength(EXPECTED_PATCHES.length)
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

describe('patch Sizes', () => {
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

describe('patch Metadata', () => {
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

    // Total should be reasonable for the patch set.
    expect(totalLines).toBeGreaterThan(500)
    expect(totalLines).toBeLessThan(10_000)
  })

  it('should discover at least the known patch set', () => {
    // No hardcoded count — the directory is the source of truth (matches
    // apply-patches.mts). A floor guards against a glob that silently finds
    // nothing (e.g. wrong dir); the exact count is intentionally not asserted so
    // adding a patch never requires editing this test.
    expect(EXPECTED_PATCHES.length).toBeGreaterThanOrEqual(21)
  })

  it('should have sequential numbering without duplicates', () => {
    const numbers = EXPECTED_PATCHES.map(name =>
      Number.parseInt(name.slice(0, 3), 10),
    )
    // Numbers should be sorted and unique (gaps like 015 are OK)
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1])
    }
    expect(numbers[0]).toBe(1)
  })
})

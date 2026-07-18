import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  findWorkspacePackageJsonFiles,
  formatNodeSmolMigrationReport,
  NODE_SMOL_MIGRATION_MANIFEST,
  NODE_SMOL_NEXT_EXTRACTION_TARGETS,
  validateManifest,
} from '../../scripts/repo/check/node-smol-migration-manifest.mts'
import type { MigrationManifestRow } from '../../scripts/repo/check/node-smol-migration-manifest.mts'

const scratchDirs: string[] = []
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(
    path.join(os.tmpdir(), 'node-smol-migration-manifest-'),
  )
  scratchDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

describe('findWorkspacePackageJsonFiles', () => {
  it('finds package roots under packages/ and packages/npm/@node-smol/', () => {
    const root = makeRepo({
      'packages/a/package.json': '{"name":"a"}',
      'packages/npm/@node-smol/b/package.json': '{"name":"b"}',
      'packages/npm/ignore-me.txt': 'nope',
    })

    expect(
      findWorkspacePackageJsonFiles(root).map(rel => path.relative(root, rel)),
    ).toEqual([
      'packages/a/package.json',
      'packages/npm/@node-smol/b/package.json',
    ])
  })
})

describe('validateManifest', () => {
  it('accepts the checked-in manifest for the real workspace roots', () => {
    expect(validateManifest(repoRoot)).toEqual([])
    expect(NODE_SMOL_MIGRATION_MANIFEST.length).toBeGreaterThan(0)
  })

  it('formats a repo-by-repo progress report with next targets', () => {
    const report = formatNodeSmolMigrationReport(repoRoot)
    expect(report).toContain('# node-smol extraction progress')
    expect(report).toContain('## node-smol')
    expect(report).toContain('## socket-btm')
    expect(report).toContain('## sockeye')
    expect(report).toContain('## stuie')
    expect(report).toContain('## Next extraction targets')
    expect(report).toContain('ultraviolet')
    expect(report).toContain('codet5-models')
    expect(report).toContain('minilm')
    expect(NODE_SMOL_NEXT_EXTRACTION_TARGETS).toHaveLength(3)
  })

  it('flags a missing package row', () => {
    const root = makeRepo({
      'packages/a/package.json': '{"name":"a"}',
    })
    const rows: readonly MigrationManifestRow[] = []

    expect(validateManifest(root, rows)).toEqual([
      expect.objectContaining({
        kind: 'missing',
        path: 'packages/a',
      }),
    ])
  })

  it('flags a duplicate package row', () => {
    const root = makeRepo({
      'packages/a/package.json': '{"name":"a"}',
    })
    const row = {
      adapterKind: 'build-tool',
      currentDisposition: 'node-smol-core',
      currentPath: 'packages/a',
      lockstepTracker: undefined,
      plannedDestination: 'socket-btm',
      publicPackage: 'a',
      removalStatus: 'retained',
      upstreamPin: undefined,
    } as const satisfies MigrationManifestRow

    expect(validateManifest(root, [row, row])).toEqual([
      expect.objectContaining({
        kind: 'duplicate',
        path: 'packages/a',
      }),
    ])
  })

  it('flags a package-name mismatch', () => {
    const root = makeRepo({
      'packages/a/package.json': '{"name":"a"}',
    })
    const row = {
      adapterKind: 'build-tool',
      currentDisposition: 'node-smol-core',
      currentPath: 'packages/a',
      lockstepTracker: undefined,
      plannedDestination: 'socket-btm',
      publicPackage: 'b',
      removalStatus: 'retained',
      upstreamPin: undefined,
    } as const satisfies MigrationManifestRow

    expect(validateManifest(root, [row])).toEqual([
      expect.objectContaining({
        kind: 'name-mismatch',
        path: 'packages/a',
      }),
    ])
  })

  it('flags a manifest row whose package root no longer exists', () => {
    const root = makeRepo({
      'packages/a/package.json': '{"name":"a"}',
    })
    const row = {
      adapterKind: 'build-tool',
      currentDisposition: 'node-smol-core',
      currentPath: 'packages/b',
      lockstepTracker: undefined,
      plannedDestination: 'socket-btm',
      publicPackage: 'b',
      removalStatus: 'retained',
      upstreamPin: undefined,
    } as const satisfies MigrationManifestRow

    expect(validateManifest(root, [row])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'missing',
          path: 'packages/a',
        }),
        expect.objectContaining({
          kind: 'orphan',
          path: 'packages/b',
        }),
      ]),
    )
  })

  it('flags a row with an impossible disposition/destination pair', () => {
    const root = makeRepo({
      'packages/a/package.json': '{"name":"a"}',
    })
    const row = {
      adapterKind: 'build-tool',
      currentDisposition: 'node-smol-core',
      currentPath: 'packages/a',
      lockstepTracker: undefined,
      plannedDestination: 'stuie',
      publicPackage: 'a',
      removalStatus: 'retained',
      upstreamPin: undefined,
    } as const satisfies MigrationManifestRow

    expect(validateManifest(root, [row])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'invalid-disposition',
          path: 'packages/a',
        }),
      ]),
    )
  })

  it('flags a non-retired row that claims pending-retire', () => {
    const root = makeRepo({
      'packages/a/package.json': '{"name":"a"}',
    })
    const row = {
      adapterKind: 'build-tool',
      currentDisposition: 'node-smol-core',
      currentPath: 'packages/a',
      lockstepTracker: undefined,
      plannedDestination: 'socket-btm',
      publicPackage: 'a',
      removalStatus: 'pending-retire',
      upstreamPin: undefined,
    } as const satisfies MigrationManifestRow

    expect(validateManifest(root, [row])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'invalid-removal-status',
          path: 'packages/a',
        }),
      ]),
    )
  })
})

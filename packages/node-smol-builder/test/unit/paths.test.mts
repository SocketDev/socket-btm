import { afterEach, describe, expect, it } from 'vitest'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { checkpointMatchesNodeVersion } from '../paths.mts'

let tempDir: string | undefined

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true })
    tempDir = undefined
  }
})

function writeCheckpoint(value: unknown): string {
  tempDir ??= mkdtempSync(path.join(os.tmpdir(), 'node-smol-paths-'))
  const checkpointPath = path.join(tempDir, 'finalized.json')
  writeFileSync(checkpointPath, JSON.stringify(value))
  return checkpointPath
}

describe('checkpointMatchesNodeVersion', () => {
  it('accepts matching versions with or without a v prefix', () => {
    const checkpointPath = writeCheckpoint({ nodeVersion: 'v26.5.0' })

    expect(checkpointMatchesNodeVersion(checkpointPath, '26.5.0')).toBe(true)
    expect(checkpointMatchesNodeVersion(checkpointPath, 'v26.5.0')).toBe(true)
  })

  it('rejects stale, missing, and malformed checkpoints', () => {
    expect(
      checkpointMatchesNodeVersion(
        writeCheckpoint({ nodeVersion: 'v26.3.1' }),
        '26.5.0',
      ),
    ).toBe(false)
    expect(checkpointMatchesNodeVersion(writeCheckpoint({}), '26.5.0')).toBe(
      false,
    )
    expect(
      checkpointMatchesNodeVersion(
        path.join(tempDir!, 'missing.json'),
        '26.5.0',
      ),
    ).toBe(false)
  })
})

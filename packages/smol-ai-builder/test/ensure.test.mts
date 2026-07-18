import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  getCurrentSmolAiPlatformArch,
  getSmolAiLocalBuildDir,
  smolAiExistsAt,
  verifySmolAiAt,
} from '../lib/ensure-smol-ai.mts'

describe('smol-ai-builder helper surface', () => {
  it('keeps the prod build dir under build/prod/<platform-arch>', () => {
    expect(getSmolAiLocalBuildDir('darwin-arm64')).toContain(
      path.join('build', 'prod', 'darwin-arm64'),
    )
  })

  it('validates the canonical addon artifact name', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'smol-ai-builder-'))
    const addon = path.join(root, 'smol_ai.node')
    writeFileSync(addon, 'x')

    expect(smolAiExistsAt(root)).toBe(true)
    expect(verifySmolAiAt(root)).toEqual({ missing: [], valid: true })
  })

  it('reports a missing addon when the file is absent', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'smol-ai-builder-missing-'))
    mkdirSync(root, { recursive: true })

    expect(smolAiExistsAt(root)).toBe(false)
    expect(verifySmolAiAt(root)).toEqual({
      missing: ['smol_ai.node'],
      valid: false,
    })
  })

  it('resolves the current platform-arch using libc awareness', () => {
    expect(getCurrentSmolAiPlatformArch()).toEqual(expect.any(String))
  })
})

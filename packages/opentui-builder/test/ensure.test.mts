import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  getCurrentOpentuiPlatformArch,
  getOpentuiLocalBuildDir,
  opentuiExistsAt,
  verifyOpentuiAt,
} from '../lib/ensure-opentui.mts'

describe('opentui-builder helper surface', () => {
  it('keeps the prod build dir under build/prod/<platform-arch>', () => {
    expect(getOpentuiLocalBuildDir('darwin-arm64')).toContain(
      path.join('build', 'prod', 'darwin-arm64'),
    )
  })

  it('validates the canonical addon artifact name', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'opentui-builder-'))
    const addon = path.join(root, 'opentui.node')
    writeFileSync(addon, 'x')

    expect(opentuiExistsAt(root)).toBe(true)
    expect(verifyOpentuiAt(root)).toEqual({ missing: [], valid: true })
  })

  it('reports a missing addon when the file is absent', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'opentui-builder-missing-'))
    mkdirSync(root, { recursive: true })

    expect(opentuiExistsAt(root)).toBe(false)
    expect(verifyOpentuiAt(root)).toEqual({
      missing: ['opentui.node'],
      valid: false,
    })
  })

  it('resolves the current platform-arch using libc awareness', () => {
    expect(getCurrentOpentuiPlatformArch()).toEqual(expect.any(String))
  })
})

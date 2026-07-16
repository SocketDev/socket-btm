/**
 * Native npm publishing must fail closed unless every target artifact is
 * present and its executable header matches the package it will enter.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, describe, expect, it } from 'vitest'

import {
  packageNameFor,
  SMOL_AI_NAPI_TARGETS,
  stageNapiArtifacts,
  tarballName,
  validateReleaseVersion,
} from '../../../scripts/repo/publish-smol-ai-napi.mts'

const scratchDirs: string[] = []

afterEach(async () => {
  for (const directory of scratchDirs.splice(0)) {
    await safeDelete(directory, { force: true })
  }
})

function makeScratch(): { artifactsDir: string; npmRoot: string } {
  const root = path.join(
    os.tmpdir(),
    `smol-ai-napi-stage-${process.pid}-${scratchDirs.length}`,
  )
  scratchDirs.push(root)
  return {
    artifactsDir: path.join(root, 'artifacts'),
    npmRoot: path.join(root, 'npm'),
  }
}

function writeFixtureTree(
  artifactsDir: string,
  npmRoot: string,
  options: {
    badMachine?: string | undefined
    badPlatform?: string | undefined
    version?: string | undefined
  } = {},
): void {
  const opts = { __proto__: null, ...options }
  const version = opts.version ?? '1.0.0'
  for (const target of SMOL_AI_NAPI_TARGETS) {
    const artifactDir = path.join(
      artifactsDir,
      `smol-ai-napi-${target.platform}`,
    )
    const packageDir = path.join(
      npmRoot,
      packageNameFor(target.platform).slice('@node-smol/'.length),
    )
    mkdirSync(artifactDir, { recursive: true })
    mkdirSync(packageDir, { recursive: true })

    const magic =
      target.platform === opts.badPlatform ? '00000000' : target.magic
    const bytes = Buffer.alloc(4096)
    Buffer.from(magic, 'hex').copy(bytes)
    const machine = target.platform === opts.badMachine ? 0 : target.machine
    if (target.platform.startsWith('darwin-')) {
      bytes.writeUInt32LE(machine, 4)
    } else if (target.platform.startsWith('linux-')) {
      bytes.writeUInt16LE(machine, 18)
    } else {
      bytes.writeUInt32LE(0x80, 0x3c)
      Buffer.from('PE\0\0').copy(bytes, 0x80)
      bytes.writeUInt16LE(machine, 0x84)
    }
    writeFileSync(path.join(artifactDir, 'smol_ai.node'), bytes)
    writeFileSync(
      path.join(packageDir, 'package.json'),
      `${JSON.stringify({ name: packageNameFor(target.platform), version })}\n`,
    )
  }
}

describe('smol-ai N-API release staging', () => {
  it('uses pnpm scoped-package tarball names', () => {
    expect(tarballName('@node-smol/ai', '1.2.3')).toBe('node-smol-ai-1.2.3.tgz')
  })

  it('stages all eight validated artifacts', () => {
    const { artifactsDir, npmRoot } = makeScratch()
    writeFixtureTree(artifactsDir, npmRoot)

    const staged = stageNapiArtifacts(artifactsDir, npmRoot)

    expect(staged).toHaveLength(8)
    for (const item of staged) {
      expect(
        readFileSync(path.join(item.packageDir, 'smol_ai.node')).length,
      ).toBeGreaterThan(1000)
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/u)
    }
  })

  it('rejects an artifact with the wrong operating-system signature', () => {
    const { artifactsDir, npmRoot } = makeScratch()
    writeFixtureTree(artifactsDir, npmRoot, {
      badPlatform: 'linux-x64-gnu',
    })

    expect(() => stageNapiArtifacts(artifactsDir, npmRoot)).toThrow(
      'linux-x64-gnu has the wrong file signature',
    )
  })

  it('rejects an artifact built for the wrong CPU architecture', () => {
    const { artifactsDir, npmRoot } = makeScratch()
    writeFixtureTree(artifactsDir, npmRoot, {
      badMachine: 'win32-arm64-msvc',
    })

    expect(() => stageNapiArtifacts(artifactsDir, npmRoot)).toThrow(
      'win32-arm64-msvc has machine 0; expected 43620',
    )
  })

  it('requires one non-placeholder version for a real stage', () => {
    const { artifactsDir, npmRoot } = makeScratch()
    writeFixtureTree(artifactsDir, npmRoot, { version: '0.0.0' })
    const wrapperDir = path.join(npmRoot, 'ai')
    mkdirSync(wrapperDir, { recursive: true })
    writeFileSync(
      path.join(wrapperDir, 'package.json'),
      `${JSON.stringify({ name: '@node-smol/ai', version: '0.0.0' })}\n`,
    )
    const staged = stageNapiArtifacts(artifactsDir, npmRoot)

    expect(() =>
      validateReleaseVersion(staged, {
        allowPlaceholder: false,
        npmRoot,
      }),
    ).toThrow('Refusing to stage placeholder version 0.0.0')
  })
})

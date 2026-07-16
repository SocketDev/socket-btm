import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  NATIVE_TARGETS,
  loadNativeBinding,
  nativePackageName,
  resolveNativeTarget,
} = require('../lib/native-loader.js') as {
  NATIVE_TARGETS: readonly string[]
  loadNativeBinding(options: {
    require: (specifier: string) => unknown
    target: string
  }): unknown
  nativePackageName(target: string): string
  resolveNativeTarget(inputs: {
    arch: string
    isMusl: boolean
    platform: NodeJS.Platform
  }): string | undefined
}

const npmRoot = path.resolve(import.meta.dirname, '../..')
const expectedTargets = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-gnu',
  'linux-arm64-musl',
  'linux-x64-gnu',
  'linux-x64-musl',
  'win32-arm64-msvc',
  'win32-x64-msvc',
]

describe('@node-smol/ai package family', () => {
  it('declares the complete eight-target N-API family', () => {
    expect(NATIVE_TARGETS).toEqual(expectedTargets)
    const wrapper = JSON.parse(
      readFileSync(path.join(npmRoot, 'ai', 'package.json'), 'utf8'),
    ) as { optionalDependencies: Record<string, string> }

    for (let i = 0, { length } = expectedTargets; i < length; i += 1) {
      const target = expectedTargets[i]!
      const packageName = nativePackageName(target)
      const directory = path.join(
        npmRoot,
        packageName.slice('@node-smol/'.length),
      )
      const manifestPath = path.join(directory, 'package.json')
      expect(existsSync(manifestPath), packageName).toBe(true)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        cpu: string[]
        libc?: string[] | undefined
        main: string
        name: string
        os: string[]
      }
      const [platform, arch, abi] = target.split('-')
      expect(manifest).toMatchObject({
        cpu: [arch],
        main: './smol_ai.node',
        name: packageName,
        os: [platform],
      })
      expect(manifest.libc).toEqual(
        platform === 'linux' ? [abi === 'musl' ? 'musl' : 'glibc'] : undefined,
      )
      expect(wrapper.optionalDependencies[packageName]).toBe('workspace:*')
    }

    expect(
      readdirSync(npmRoot)
        .filter(name => name.startsWith('ai.node-'))
        .toSorted(),
    ).toEqual(expectedTargets.map(target => `ai.node-${target}`).toSorted())
  })

  it('resolves libc and CPU without crossing naming domains', () => {
    expect(
      resolveNativeTarget({ arch: 'arm64', isMusl: false, platform: 'darwin' }),
    ).toBe('darwin-arm64')
    expect(
      resolveNativeTarget({ arch: 'x64', isMusl: false, platform: 'linux' }),
    ).toBe('linux-x64-gnu')
    expect(
      resolveNativeTarget({ arch: 'x64', isMusl: true, platform: 'linux' }),
    ).toBe('linux-x64-musl')
    expect(
      resolveNativeTarget({ arch: 'arm64', isMusl: false, platform: 'win32' }),
    ).toBe('win32-arm64-msvc')
    expect(
      resolveNativeTarget({ arch: 'x64', isMusl: false, platform: 'freebsd' }),
    ).toBeUndefined()
  })

  it('surfaces a missing or unloadable native package with its exact name', () => {
    const requireNative = vi.fn(() => {
      const error = new Error('dlopen failed')
      Object.assign(error, { code: 'ERR_DLOPEN_FAILED' })
      throw error
    })

    expect(() =>
      loadNativeBinding({ require: requireNative, target: 'darwin-arm64' }),
    ).toThrow(/@node-smol\/ai\.node-darwin-arm64.*dlopen failed/i)
  })
})

import { describe, expect, it } from 'vitest'

import {
  assetName,
  validateBinary,
  validateVersion,
} from '../scripts/stage-release.mts'

function binary(kind: 'elf' | 'mach-o' | 'pe', machine: number): Buffer {
  const bytes = Buffer.alloc(1024)
  if (kind === 'elf') {
    bytes.set([0x7f, 0x45, 0x4c, 0x46])
    bytes.writeUInt16LE(machine, 18)
  } else if (kind === 'mach-o') {
    bytes.writeUInt32LE(0xfe_ed_fa_cf, 0)
    bytes.writeUInt32LE(machine, 4)
  } else {
    bytes.write('MZ', 0, 'ascii')
    bytes.writeUInt32LE(0x80, 0x3c)
    bytes.writeUInt32LE(0x00_00_45_50, 0x80)
    bytes.writeUInt16LE(machine, 0x84)
  }
  return bytes
}

describe('Keychain addon release contract', () => {
  it('uses stable semantic-versioned asset names', () => {
    expect(assetName('1.2.3', 'darwin-arm64')).toBe(
      'keychain-addon-1.2.3-darwin-arm64.node',
    )
    expect(() => validateVersion('v1.2.3')).toThrow(/plain semantic version/u)
  })

  it.each([
    ['darwin-arm64', 'mach-o', 0x01_00_00_0c],
    ['darwin-x64', 'mach-o', 0x01_00_00_07],
    ['linux-arm64', 'elf', 183],
    ['linux-x64', 'elf', 62],
    ['win32-x64', 'pe', 0x86_64],
  ] as const)('accepts the expected %s binary', (target, kind, machine) => {
    expect(() => validateBinary(binary(kind, machine), target)).not.toThrow()
  })

  it('rejects a correctly formatted binary for the wrong CPU', () => {
    expect(() =>
      validateBinary(binary('mach-o', 0x01_00_00_07), 'darwin-arm64'),
    ).toThrow(/target mismatch/u)
  })
})

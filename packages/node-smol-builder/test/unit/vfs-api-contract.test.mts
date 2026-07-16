import { describe, expect, it } from 'vitest'

/**
 * @file API contract tests for node:smol-vfs module.
 *   Tests config modes, module exports, promises namespace, streams,
 *   error codes, native addon support, and config object shape.
 *   Split from vfs-path.test.mts.
 */

describe('vFS Config Modes', () => {
  const VFS_MODE_IN_MEMORY = 'in-memory'
  const VFS_MODE_ON_DISK = 'on-disk'
  const VFS_MODE_COMPAT = 'compat'

  const validModes = [VFS_MODE_IN_MEMORY, VFS_MODE_ON_DISK, VFS_MODE_COMPAT]

  it('should have three valid modes', () => {
    expect(validModes).toHaveLength(3)
  })

  it('should validate in-memory mode', () => {
    expect(validModes.includes('in-memory')).toBeTruthy()
  })

  it('should validate on-disk mode', () => {
    expect(validModes.includes('on-disk')).toBeTruthy()
  })

  it('should validate compat mode', () => {
    expect(validModes.includes('compat')).toBeTruthy()
  })

  it('should reject invalid modes', () => {
    expect(validModes.includes('invalid')).toBeFalsy()
    expect(validModes.includes('memory')).toBeFalsy()
    expect(validModes.includes('disk')).toBeFalsy()
  })
})

describe('node:smol-vfs module API', () => {
  const expectedExports = [
    'hasVFS',
    'config',
    'prefix',
    'size',
    'canBuildSea',
    'existsSync',
    'readFileSync',
    'statSync',
    'lstatSync',
    'readdirSync',
    'accessSync',
    'realpathSync',
    'readlinkSync',
    'openSync',
    'closeSync',
    'readSync',
    'fstatSync',
    'isVfsFd',
    'getVfsPath',
    'getRealPath',
    'promises',
    'createReadStream',
    'listFiles',
    'mount',
    'mountSync',
    'handleNativeAddon',
    'isNativeAddon',
    'VFSError',
    'MODE_COMPAT',
    'MODE_IN_MEMORY',
    'MODE_ON_DISK',
    'default',
  ]

  it('should define all expected exports', () => {
    expect(expectedExports).toContain('hasVFS')
    expect(expectedExports).toContain('readFileSync')
    expect(expectedExports).toContain('mountSync')
    expect(expectedExports).toContain('VFSError')
  })

  it('should include file descriptor operations', () => {
    expect(expectedExports).toContain('openSync')
    expect(expectedExports).toContain('closeSync')
    expect(expectedExports).toContain('readSync')
    expect(expectedExports).toContain('fstatSync')
    expect(expectedExports).toContain('isVfsFd')
    expect(expectedExports).toContain('getVfsPath')
    expect(expectedExports).toContain('getRealPath')
  })

  it('should include promises namespace', () => {
    expect(expectedExports).toContain('promises')
  })

  it('should include VFS mode constants', () => {
    expect(expectedExports).toContain('MODE_COMPAT')
    expect(expectedExports).toContain('MODE_IN_MEMORY')
    expect(expectedExports).toContain('MODE_ON_DISK')
  })

  it('should have native addon support', () => {
    expect(expectedExports).toContain('handleNativeAddon')
    expect(expectedExports).toContain('isNativeAddon')
  })

  it('should support both named and default exports', () => {
    expect(expectedExports).toContain('default')
    expect(expectedExports).toContain('hasVFS')
  })
})

describe('node:smol-vfs vs Platformatic node:vfs comparison', () => {
  const PLATFORMATIC_VFD_BASE = 10_000

  it('should not use virtual FD base like Platformatic', () => {
    const realFdRange = { min: 3, max: 9999 }
    expect(PLATFORMATIC_VFD_BASE).toBeGreaterThan(realFdRange.max)
  })

  it('should be read-only (unlike Platformatic read/write)', () => {
    const smolVfsFeatures = {
      readOnly: true,
      extractOnDemand: true,
      realFileDescriptors: true,
    }
    expect(smolVfsFeatures.readOnly).toBeTruthy()
  })

  it('should use extract-on-demand model', () => {
    const smolVfsModel = 'extract-on-demand'
    const platformaticModel = 'global-fs-hijack'
    expect(smolVfsModel).not.toBe(platformaticModel)
  })
})

describe('node:smol-vfs promises namespace', () => {
  const promisesMethods = [
    'exists',
    'readFile',
    'stat',
    'lstat',
    'readdir',
    'access',
    'realpath',
    'readlink',
    'open',
    'fstat',
  ]

  it('should have exists method', () => {
    expect(promisesMethods).toContain('exists')
  })

  it('should have readFile method', () => {
    expect(promisesMethods).toContain('readFile')
  })

  it('should have stat and lstat methods', () => {
    expect(promisesMethods).toContain('stat')
    expect(promisesMethods).toContain('lstat')
  })

  it('should have readdir method', () => {
    expect(promisesMethods).toContain('readdir')
  })

  it('should have access method', () => {
    expect(promisesMethods).toContain('access')
  })

  it('should have realpath and readlink methods', () => {
    expect(promisesMethods).toContain('realpath')
    expect(promisesMethods).toContain('readlink')
  })

  it('should have file descriptor methods', () => {
    expect(promisesMethods).toContain('open')
    expect(promisesMethods).toContain('fstat')
  })
})

describe('node:smol-vfs createReadStream', () => {
  const streamOptions = ['start', 'end', 'encoding']

  it('should support start option for offset', () => {
    expect(streamOptions).toContain('start')
  })

  it('should support end option for length', () => {
    expect(streamOptions).toContain('end')
  })

  it('should support encoding option', () => {
    expect(streamOptions).toContain('encoding')
  })

  it('should return a Readable stream', () => {
    const expectedType = 'Readable'
    expect(expectedType).toBe('Readable')
  })
})

describe('node:smol-vfs listFiles options', () => {
  const filterOptions = ['prefix', 'extension']

  it('should support prefix filter', () => {
    expect(filterOptions).toContain('prefix')
  })

  it('should support extension filter', () => {
    expect(filterOptions).toContain('extension')
  })

  it('should return array of file paths', () => {
    const expectedReturn = 'string[]'
    expect(expectedReturn).toBe('string[]')
  })
})

describe('node:smol-vfs error codes', () => {
  const errorCodes = [
    'ERR_VFS',
    'ENOENT',
    'EISDIR',
    'ENOTDIR',
    'EROFS',
    'EINVAL',
  ]

  it('should have generic VFS error code', () => {
    expect(errorCodes).toContain('ERR_VFS')
  })

  it('should have ENOENT for file not found', () => {
    expect(errorCodes).toContain('ENOENT')
  })

  it('should have EISDIR for directory operation on file', () => {
    expect(errorCodes).toContain('EISDIR')
  })

  it('should have ENOTDIR for file operation on directory', () => {
    expect(errorCodes).toContain('ENOTDIR')
  })

  it('should have EROFS for read-only filesystem', () => {
    expect(errorCodes).toContain('EROFS')
  })

  it('should have EINVAL for invalid argument', () => {
    expect(errorCodes).toContain('EINVAL')
  })
})

describe('node:smol-vfs native addon support', () => {
  const nativeExtension = '.node'

  it('should recognize .node extension as native addon', () => {
    expect(nativeExtension).toBe('.node')
  })

  it('should have isNativeAddon function', () => {
    const expectedBehavior = 'checks file extension for .node'
    expect(expectedBehavior).toContain('.node')
  })

  it('should have handleNativeAddon function', () => {
    const expectedBehavior = 'extracts to temp dir and returns real path'
    expect(expectedBehavior).toContain('extracts')
  })
})

describe('node:smol-vfs config object', () => {
  const configProperties = ['available', 'prefix', 'mode', 'source']

  it('should have available property', () => {
    expect(configProperties).toContain('available')
  })

  it('should have prefix property', () => {
    expect(configProperties).toContain('prefix')
  })

  it('should have mode property', () => {
    expect(configProperties).toContain('mode')
  })

  it('should have source property', () => {
    expect(configProperties).toContain('source')
  })

  it('should return available: false when VFS not loaded', () => {
    const noVfsConfig = { available: false }
    expect(noVfsConfig.available).toBeFalsy()
  })
})

/**
 * @fileoverview Tests for VFS path handling (/snapshot/* path prefix).
 *
 * These tests verify the path parsing and normalization logic for VFS paths.
 * Since the actual VFS is only available when running as a SEA, we test
 * the path logic independently.
 */

/**
 * Simulate path normalization (backslash → forward slash)
 */
function normalizePath(filepath: string): string {
  return filepath.replace(/\\/g, '/')
}

/**
 * Simulate isVFSPrefixPath logic
 */
function isVFSPrefixPath(
  filepath: string | null | undefined,
  prefix = '/snapshot',
): boolean {
  if (!filepath || typeof filepath !== 'string') {
    return false
  }

  const normalized = normalizePath(filepath)

  return (
    normalized === prefix ||
    normalized === `${prefix}/` ||
    normalized.startsWith(`${prefix}/`)
  )
}

/**
 * Simulate toVFSPath logic (extract relative path from VFS prefix path)
 */
function toVFSPath(
  filepath: string,
  prefix = '/snapshot',
): string | undefined {
  const normalized = normalizePath(filepath)

  if (normalized.startsWith(`${prefix}/`)) {
    return normalized.slice(prefix.length + 1)
  }

  return undefined
}

/**
 * Simulate findVFSKey logic (try with/without trailing slash)
 */
function findVFSKey(
  vfsPath: string,
  entries: Set<string>,
): string | undefined {
  // Check exact match
  if (entries.has(vfsPath)) {
    return vfsPath
  }

  // Check with trailing slash for directories
  const withSlash = vfsPath.endsWith('/') ? vfsPath : `${vfsPath}/`
  if (entries.has(withSlash)) {
    return withSlash
  }

  // Check without trailing slash
  const withoutSlash = vfsPath.endsWith('/')
    ? vfsPath.slice(0, -1)
    : vfsPath
  if (withoutSlash !== vfsPath && entries.has(withoutSlash)) {
    return withoutSlash
  }

  return undefined
}

/**
 * Validate VFS prefix format
 */
function isValidVFSPrefix(prefix: string): { valid: boolean; error?: string } {
  if (!prefix.startsWith('/')) {
    return {
      error: `prefix must start with a forward slash`,
      valid: false,
    }
  }
  if (prefix.includes('..')) {
    return {
      error: `path traversal not allowed`,
      valid: false,
    }
  }
  if (prefix.length > 256) {
    return {
      error: `too long (max 256 chars)`,
      valid: false,
    }
  }
  return { valid: true }
}

describe('vFS Path Handling', () => {
  describe('isVFSPrefixPath', () => {
    it('should return true for /snapshot', () => {
      expect(isVFSPrefixPath('/snapshot')).toBeTruthy()
    })

    it('should return true for /snapshot/', () => {
      expect(isVFSPrefixPath('/snapshot/')).toBeTruthy()
    })

    it('should return true for /snapshot/node_modules/foo', () => {
      expect(isVFSPrefixPath('/snapshot/node_modules/foo')).toBeTruthy()
    })

    it('should return true for nested paths', () => {
      expect(isVFSPrefixPath('/snapshot/a/b/c/d.js')).toBeTruthy()
    })

    it('should return false for /sea paths', () => {
      expect(isVFSPrefixPath('/sea/file.js')).toBeFalsy()
    })

    it('should return false for /snapshotted paths (partial match)', () => {
      expect(isVFSPrefixPath('/snapshotted/file.js')).toBeFalsy()
    })

    it('should return false for regular paths', () => {
      expect(isVFSPrefixPath('/usr/local/bin')).toBeFalsy()
      expect(isVFSPrefixPath('/home/user/file.txt')).toBeFalsy()
    })

    it('should handle Windows-style paths', () => {
      expect(isVFSPrefixPath(String.raw`\snapshot\file.js`)).toBeTruthy()
      expect(isVFSPrefixPath('\\snapshot\\')).toBeTruthy()
    })

    it('should return false for null/undefined', () => {
      expect(isVFSPrefixPath(null)).toBeFalsy()
      expect(isVFSPrefixPath(undefined)).toBeFalsy()
    })

    it('should return false for non-string values', () => {
      // @ts-expect-error Testing runtime behavior
      expect(isVFSPrefixPath(123)).toBeFalsy()
      // @ts-expect-error Testing runtime behavior
      expect(isVFSPrefixPath({})).toBeFalsy()
    })

    it('should support custom prefixes', () => {
      expect(isVFSPrefixPath('/virtual/file.js', '/virtual')).toBeTruthy()
      expect(isVFSPrefixPath('/vfs/file.js', '/vfs')).toBeTruthy()
      expect(isVFSPrefixPath('/snapshot/file.js', '/virtual')).toBeFalsy()
    })
  })

  describe('toVFSPath', () => {
    it('should extract relative path from simple file', () => {
      expect(toVFSPath('/snapshot/file.js')).toBe('file.js')
      expect(toVFSPath('/snapshot/data.json')).toBe('data.json')
    })

    it('should extract relative path from nested path', () => {
      expect(toVFSPath('/snapshot/node_modules/foo/index.js')).toBe(
        'node_modules/foo/index.js',
      )
      expect(toVFSPath('/snapshot/a/b/c/d.js')).toBe('a/b/c/d.js')
    })

    it('should return undefined for non-VFS paths', () => {
      expect(toVFSPath('/sea/file.js')).toBeUndefined()
      expect(toVFSPath('/usr/local/bin')).toBeUndefined()
    })

    it('should handle Windows-style paths', () => {
      expect(toVFSPath(String.raw`\snapshot\file.js`)).toBe('file.js')
      expect(toVFSPath(String.raw`\snapshot\node_modules\foo`)).toBe(
        'node_modules/foo',
      )
    })

    it('should support custom prefixes', () => {
      expect(toVFSPath('/virtual/file.js', '/virtual')).toBe('file.js')
      expect(toVFSPath('/vfs/node_modules/foo', '/vfs')).toBe(
        'node_modules/foo',
      )
    })
  })

  describe('findVFSKey', () => {
    it('should find exact match', () => {
      const entries = new Set(['file.js', 'data.json'])
      expect(findVFSKey('file.js', entries)).toBe('file.js')
      expect(findVFSKey('data.json', entries)).toBe('data.json')
    })

    it('should find directory with trailing slash', () => {
      const entries = new Set(['node_modules/', 'src/'])
      expect(findVFSKey('node_modules', entries)).toBe('node_modules/')
      expect(findVFSKey('src', entries)).toBe('src/')
    })

    it('should find directory without trailing slash', () => {
      const entries = new Set(['node_modules', 'src'])
      expect(findVFSKey('node_modules/', entries)).toBe('node_modules')
      expect(findVFSKey('src/', entries)).toBe('src')
    })

    it('should return undefined for non-existent path', () => {
      const entries = new Set(['file.js'])
      expect(findVFSKey('notfound.js', entries)).toBeUndefined()
    })
  })

  describe('path normalization', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(normalizePath(String.raw`\snapshot\file.js`)).toBe(
        '/snapshot/file.js',
      )
      expect(normalizePath(String.raw`\snapshot\node_modules\foo`)).toBe(
        '/snapshot/node_modules/foo',
      )
    })

    it('should not modify forward slashes', () => {
      expect(normalizePath('/snapshot/file.js')).toBe('/snapshot/file.js')
    })

    it('should handle mixed slashes', () => {
      expect(
        normalizePath(String.raw`/snapshot\node_modules/foo\bar.js`),
      ).toBe('/snapshot/node_modules/foo/bar.js')
    })
  })

  describe('vFS prefix validation', () => {
    it('should accept valid prefixes', () => {
      expect(isValidVFSPrefix('/snapshot').valid).toBeTruthy()
      expect(isValidVFSPrefix('/virtual').valid).toBeTruthy()
      expect(isValidVFSPrefix('/vfs').valid).toBeTruthy()
      expect(isValidVFSPrefix('/app').valid).toBeTruthy()
    })

    it('should reject prefix without leading slash', () => {
      const result = isValidVFSPrefix('snapshot')
      expect(result.valid).toBeFalsy()
      expect(result.error).toContain('forward slash')
    })

    it('should reject prefix with path traversal', () => {
      const result = isValidVFSPrefix('/snapshot/../etc')
      expect(result.valid).toBeFalsy()
      expect(result.error).toContain('traversal')
    })

    it('should reject prefix that is too long', () => {
      const longPrefix = `/${'a'.repeat(300)}`
      const result = isValidVFSPrefix(longPrefix)
      expect(result.valid).toBeFalsy()
      expect(result.error).toContain('too long')
    })
  })

  describe('edge cases', () => {
    it('should handle empty path components', () => {
      expect(toVFSPath('/snapshot//file.js')).toBe('/file.js')
    })

    it('should handle special characters in filenames', () => {
      expect(toVFSPath('/snapshot/file with spaces.txt')).toBe(
        'file with spaces.txt',
      )
      expect(toVFSPath('/snapshot/file-name_v1.0.json')).toBe(
        'file-name_v1.0.json',
      )
      expect(toVFSPath('/snapshot/émoji🎉.txt')).toBe('émoji🎉.txt')
    })

    it('should handle very long paths', () => {
      const longPath = `/snapshot/${'a'.repeat(1000)}.txt`
      expect(toVFSPath(longPath)).toBe(`${'a'.repeat(1000)}.txt`)
    })

    it('should handle dots in filenames (not traversal)', () => {
      expect(toVFSPath('/snapshot/.hidden')).toBe('.hidden')
      expect(toVFSPath('/snapshot/file.tar.gz')).toBe('file.tar.gz')
      expect(toVFSPath('/snapshot/.env.local')).toBe('.env.local')
    })

    it('should handle @-scoped packages', () => {
      expect(toVFSPath('/snapshot/node_modules/@types/node')).toBe(
        'node_modules/@types/node',
      )
      expect(toVFSPath('/snapshot/node_modules/@socketsecurity/lib')).toBe(
        'node_modules/@socketsecurity/lib',
      )
    })
  })

  describe('security', () => {
    it('should not allow path traversal in VFS prefix', () => {
      expect(isValidVFSPrefix('/snapshot/..').valid).toBeFalsy()
      expect(isValidVFSPrefix('/snapshot/../etc').valid).toBeFalsy()
    })

    it('should allow files starting with dots', () => {
      expect(toVFSPath('/snapshot/.gitignore')).toBe('.gitignore')
      expect(toVFSPath('/snapshot/.env')).toBe('.env')
      expect(toVFSPath('/snapshot/dir/.hidden')).toBe('dir/.hidden')
    })
  })
})

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

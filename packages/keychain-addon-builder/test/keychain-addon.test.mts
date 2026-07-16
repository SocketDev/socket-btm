/**
 * @file Build-output test for keychain.node. Loads the compiled addon and
 *   exercises the paths that DON'T raise a biometric prompt (a missing item:
 *   get → undefined, del → no-op). Skips unless the addon has been built for
 *   the host platform (a bare checkout hasn't). The write + biometric-read
 *   round-trip needs an interactive Touch ID prompt, so it's verified manually.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'

import { afterAll, describe, expect, it } from 'vitest'

import { getKeychainAddonBinaryPath } from '../scripts/paths.mts'

const platformArch = `${process.platform}-${process.arch}`
const binaryPath = getKeychainAddonBinaryPath('dev', platformArch)
const built = existsSync(binaryPath)
const require = createRequire(import.meta.url)

// A service/account that cannot exist, so get/del take the not-found path and
// never prompt.
const MISSING_SERVICE = 'socket-keychain-addon-test-missing'
const MISSING_ACCOUNT = 'NOPE'

describe.skipIf(!built)('keychain.node', () => {
  const keychain = require(binaryPath) as {
    get: (service: string, account: string) => string | undefined
    set: (service: string, account: string, value: string) => undefined
    del: (service: string, account: string) => undefined
  }

  afterAll(() => {
    // Belt-and-suspenders: ensure the test item never lingers in the keychain.
    try {
      keychain.del(MISSING_SERVICE, MISSING_ACCOUNT)
    } catch {
      // Ignore — nothing to clean.
    }
  })

  it('exposes get/set/del', () => {
    expect(typeof keychain.get).toBe('function')
    expect(typeof keychain.set).toBe('function')
    expect(typeof keychain.del).toBe('function')
  })

  it('get returns undefined for a missing item (no prompt)', () => {
    expect(keychain.get(MISSING_SERVICE, MISSING_ACCOUNT)).toBeUndefined()
  })

  it('del of a missing item is a no-op', () => {
    expect(keychain.del(MISSING_SERVICE, MISSING_ACCOUNT)).toBeUndefined()
  })

  it('rejects fields that would be truncated by the C boundary', () => {
    expect(() => keychain.get('s'.repeat(256), MISSING_ACCOUNT)).toThrow(
      TypeError,
    )
    expect(() =>
      keychain.set(MISSING_SERVICE, MISSING_ACCOUNT, 'v'.repeat(8192)),
    ).toThrow(TypeError)
  })

  it('rejects embedded NUL bytes', () => {
    expect(() => keychain.get('socket\0security', MISSING_ACCOUNT)).toThrow(
      TypeError,
    )
  })
})

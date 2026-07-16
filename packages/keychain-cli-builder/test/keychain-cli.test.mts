/**
 * @file Non-destructive CLI contract tests. Missing reads and deletes do not
 *   create Keychain entries or show a biometric prompt. Invalid set input is
 *   rejected before the platform backend is called.
 */

import { existsSync } from 'node:fs'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { getKeychainCliBinaryPath } from '../scripts/paths.mts'

const target = `${process.platform}-${process.arch}`
const binaryPath = getKeychainCliBinaryPath('dev', target)
const built = existsSync(binaryPath)
const service = 'socket-keychain-cli-test-missing'
const account = 'NOPE'

describe.skipIf(!built)('socket-keychain CLI', () => {
  it('reports its version and command help', () => {
    const version = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' })
    expect(version.status).toBe(0)
    expect(version.stdout).toMatch(/^socket-keychain /u)

    const help = spawnSync(binaryPath, ['--help'], { encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('set <service> <account>')
  })

  it('uses exit code 3 for a missing credential', () => {
    const result = spawnSync(binaryPath, ['get', service, account], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(3)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('not found')
  })

  it('treats deleting a missing credential as success', () => {
    const result = spawnSync(binaryPath, ['delete', service, account], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('rejects empty and oversized stdin before storing', () => {
    const empty = spawnSync(binaryPath, ['set', service, account], {
      encoding: 'utf8',
      input: '',
    })
    expect(empty.status).toBe(2)

    const oversized = spawnSync(binaryPath, ['set', service, account], {
      encoding: 'utf8',
      input: 'x'.repeat(8192),
    })
    expect(oversized.status).toBe(2)
  })
})

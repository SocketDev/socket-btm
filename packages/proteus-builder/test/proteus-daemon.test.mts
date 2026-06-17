/**
 * @file Lifecycle tests for the proteus daemon. These spawn the built binary
 *   and exercise the socket protocol, so they skip unless the daemon has been
 *   built for the host platform (CI builds it in the release job; a bare
 *   checkout has not). The biometric-gated keychain read can't run unattended,
 *   so we cover the paths that don't raise a Touch ID prompt: ping, a get of a
 *   missing item (not-found), a delete of a missing item, and an unknown op.
 */
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getProteusBinaryPath } from '../scripts/paths.mts'

const platformArch = `${process.platform}-${process.arch}`
const binaryPath = getProteusBinaryPath('dev', platformArch)
const built = existsSync(binaryPath)
const sockPath = path.join(process.env['TMPDIR'] ?? '/tmp', 'proteus-test.sock')
const pidPath = `${sockPath}.pid`

function request(payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sockPath, () => conn.write(`${payload}\n`))
    conn.on('data', data => {
      resolve(String(data).trim())
      conn.end()
    })
    conn.on('error', reject)
  })
}

describe.skipIf(!built)('proteus daemon', () => {
  // The lib spawn() promise resolves on process exit; for a long-lived daemon
  // we keep the live ChildProcess via `.process` and never await the promise
  // (swallowing the SIGTERM-kill rejection at teardown).
  let daemon: ReturnType<typeof spawn>['process'] | undefined

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      const running = spawn(binaryPath, [sockPath, pidPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      running.catch(() => {})
      daemon = running.process
      daemon.stdout?.on('data', chunk => {
        if (String(chunk).includes('daemon started')) {
          resolve()
        }
      })
      daemon.on('error', reject)
      setTimeout(() => reject(new Error('daemon did not start')), 5000).unref()
    })
  })

  afterAll(() => {
    daemon?.kill('SIGTERM')
  })

  it('answers the ping liveness probe', async () => {
    expect(await request('ping')).toBe('{"ok":true,"pong":true}')
  })

  it('reports not-found for a missing credential', async () => {
    const res = await request(
      JSON.stringify({
        account: 'NOPE',
        op: 'get',
        service: 'socket-proteus-test-missing',
      }),
    )
    expect(res).toContain('"ok":false')
    expect(res).toContain('not-found')
  })

  it('treats deleting a missing credential as success', async () => {
    const res = await request(
      JSON.stringify({
        account: 'NOPE',
        op: 'delete',
        service: 'socket-proteus-test-missing',
      }),
    )
    expect(res).toBe('{"ok":true,"deleted":true}')
  })

  it('rejects an unknown op', async () => {
    const res = await request(
      JSON.stringify({ account: 'y', op: 'frobnicate', service: 'x' }),
    )
    expect(res).toContain('unknown-op')
  })
})

describe.skipIf(!built)('proteus daemon single-instance', () => {
  it('a second daemon refuses to start while the first holds the pidfile', async () => {
    const lockSock = path.join(
      process.env['TMPDIR'] ?? '/tmp',
      'proteus-single-test.sock',
    )
    const lockPid = `${lockSock}.pid`
    // Idle-disabled so the first daemon stays up holding the lock.
    const spawnOpts = {
      env: { ...process.env, PROTEUS_IDLE_SECONDS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    }
    const firstRun = spawn(binaryPath, [lockSock, lockPid], spawnOpts)
    firstRun.catch(() => {})
    const first = firstRun.process
    await new Promise<void>((resolve, reject) => {
      first.stdout?.on('data', chunk => {
        if (String(chunk).includes('daemon started')) {
          resolve()
        }
      })
      first.on('error', reject)
      setTimeout(() => reject(new Error('first did not start')), 5000).unref()
    })
    try {
      // Second daemon, same socket + pidfile, must refuse and exit non-zero.
      const second = await new Promise<{ code: number | null; err: string }>(
        (resolve, reject) => {
          const run = spawn(binaryPath, [lockSock, lockPid], spawnOpts)
          run.catch(() => {})
          let err = ''
          run.process.stderr?.on('data', chunk => (err += String(chunk)))
          run.process.on('exit', code => resolve({ code, err }))
          run.process.on('error', reject)
          setTimeout(
            () => reject(new Error('second did not exit')),
            5000,
          ).unref()
        },
      )
      expect(second.code).not.toBe(0)
      expect(second.err).toContain('already running')
    } finally {
      first.kill('SIGTERM')
    }
  })
})

describe.skipIf(!built)('proteus daemon idle-shutdown', () => {
  it('self-exits cleanly and removes its socket + pidfile after the idle timeout', async () => {
    const idleSock = path.join(
      process.env['TMPDIR'] ?? '/tmp',
      'proteus-idle-test.sock',
    )
    const idlePid = `${idleSock}.pid`
    await new Promise<void>((resolve, reject) => {
      // PROTEUS_IDLE_SECONDS=1: with no connection, SIGALRM fires in ~1s and the
      // daemon cleans up and exits 0.
      const running = spawn(binaryPath, [idleSock, idlePid], {
        env: { ...process.env, PROTEUS_IDLE_SECONDS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      running.catch(() => {})
      const proc = running.process
      proc.on('exit', code => {
        try {
          expect(code).toBe(0)
          expect(existsSync(idleSock)).toBe(false)
          expect(existsSync(idlePid)).toBe(false)
          resolve()
        } catch (e) {
          reject(e)
        }
      })
      proc.on('error', reject)
      setTimeout(
        () => reject(new Error('daemon did not idle-exit within 6s')),
        6000,
      ).unref()
    })
  })
})

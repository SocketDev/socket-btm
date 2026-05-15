import { promises as fs } from 'node:fs'

/**
 * Lock-file helpers shared by checkpoint create / restore / cleanup.
 * Each callsite needs the same try/open/lock/finally/unlock/close
 * boilerplate; lifting it here makes the three call sites read as
 * the lock-relevant lines plus a one-line wrapper.
 *
 * Windows lacks `flock`; Node 22's `FileHandle.lock` / `unlock` are
 * undefined there. Both helpers no-op the lock acquisition in that
 * case and still open + close the file handle so any stray "lock
 * file exists" cleanup behavior continues to work.
 *
 * The lock file is opened with mode `'a'` (append) — the file is
 * never written, but `'a'` creates the file if missing without
 * truncating an existing one. Opening with `'w'` would clobber any
 * stale lock from a previous run; the append-mode open is the
 * inode-stable shape flock() expects.
 */

type LockableHandle = Awaited<ReturnType<typeof fs.open>> & {
  lock?: ((mode: 'sh' | 'ex') => Promise<void>) | undefined
  tryLock?: ((mode: 'sh' | 'ex') => Promise<boolean>) | undefined
  unlock?: (() => Promise<void>) | undefined
}

/**
 * Run `fn` while holding a blocking shared (`'sh'`) or exclusive
 * (`'ex'`) lock on `lockPath`. On Windows the lock-acquisition step
 * is a no-op (FileHandle.lock undefined). The lock is always
 * released and the handle always closed; unlock/close errors are
 * swallowed (same posture as before the extraction).
 */
export async function withLock<T>(
  lockPath: string,
  mode: 'sh' | 'ex',
  fn: () => Promise<T>,
): Promise<T> {
  let lockFile: LockableHandle | undefined
  try {
    lockFile = (await fs.open(lockPath, 'a')) as LockableHandle
    if (typeof lockFile.lock === 'function') {
      await lockFile.lock(mode)
    }
    return await fn()
  } finally {
    if (lockFile) {
      try {
        if (typeof lockFile.unlock === 'function') {
          await lockFile.unlock()
        }
        await lockFile.close()
      } catch {
        // Ignore unlock/close errors.
      }
    }
  }
}

/**
 * Try to acquire an exclusive non-blocking lock on `lockPath`; pass
 * `acquired` (true|false) to `fn`. On Windows where flock is
 * unavailable, `acquired` is reported as `true` (the caller can
 * proceed; nothing else can hold a lock anyway). The handle is
 * always closed; unlock only fires when the lock was acquired.
 *
 * Errors during open/lock are surfaced via the catch path: `fn` is
 * never called and a swallowed error is signaled by `fn` not being
 * invoked. Callers needing the original lock-error must not rely on
 * this helper.
 */
export async function withTryLock<T>(
  lockPath: string,
  fn: (acquired: boolean) => Promise<T>,
): Promise<T | undefined> {
  let lockFile: LockableHandle | undefined
  let acquired = false
  try {
    lockFile = (await fs.open(lockPath, 'a')) as LockableHandle
    if (typeof lockFile.tryLock === 'function') {
      acquired = await lockFile.tryLock('ex')
    } else {
      // Platform without non-blocking flock (Windows, or a Node build
      // that ships `lock` but not `tryLock`). Treat as "no contention
      // detectable" — the caller proceeds because there's nothing else
      // that could be holding the lock.
      acquired = true
    }
    return await fn(acquired)
  } catch {
    return undefined
  } finally {
    if (lockFile) {
      try {
        if (acquired && typeof lockFile.unlock === 'function') {
          await lockFile.unlock()
        }
        await lockFile.close()
      } catch {
        // Ignore unlock/close errors.
      }
    }
  }
}

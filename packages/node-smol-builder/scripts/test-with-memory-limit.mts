#!/usr/bin/env node
/**
 * Cross-platform memory-limited test runner
 * Usage: node scripts/test-with-memory-limit.mts [vitest args...]
 */

import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn, spawnSync } from '@socketsecurity/lib-stable/spawn'
import { errorMessage } from 'build-infra/lib/error-utils'

import { isOnAcPower } from '../../../scripts/power-state.mts'

const logger = getDefaultLogger()

const MAX_MEMORY_MB = 2048 // 2GB limit
const CHECK_INTERVAL_MS = 1000 // Check every 1 second

const ON_AC = await isOnAcPower()

// Test suite builds full SEA binaries (~5s each, ~30 of them) plus
// VFS extraction tests. On battery, macOS especially throttles CPU
// hard — local laptop runs are ~2x slower, sometimes ~3x. Use a
// shorter timeout when plugged in to fail-fast on real regressions
// and a longer one on battery so a transient power state doesn't
// kill an otherwise-healthy run.
const TIMEOUT_MS = ON_AC ? 480_000 : 900_000 // 8 min (AC) | 15 min (battery)

const vitestArgs = process.argv.slice(2)

logger.log(
  `Memory limit: ${MAX_MEMORY_MB}MB | Timeout: ${TIMEOUT_MS / 1000}s ` +
    `(${ON_AC ? 'AC power' : 'battery — extended'})`,
)
logger.log(`Running: vitest ${vitestArgs.join(' ')}`)
logger.log('')

// Spawn vitest process using @socketsecurity/lib spawn
const vitestPromise = spawn('pnpm', ['exec', 'vitest', 'run', ...vitestArgs], {
  shell: WIN32,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: `--max-old-space-size=${MAX_MEMORY_MB}`,
  },
})

const vitestProcess = vitestPromise.process

const startTime = Date.now()
let killed = false

// Get memory usage cross-platform
export function getMemoryUsageMB(pid) {
  try {
    if (WIN32) {
      // Windows: Use PowerShell (wmic is deprecated/removed on Windows 11+)
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
        { encoding: 'utf8' },
      )
      const bytes = parseInt(String(result.stdout).trim(), 10)
      if (Number.isNaN(bytes)) {
        return 0
      }
      return Math.floor(bytes / 1024 / 1024)
    }
    // macOS/Linux: Use ps
    const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
    })
    const kb = parseInt(String(result.stdout).trim(), 10)
    if (Number.isNaN(kb)) {
      return 0
    }
    return Math.floor(kb / 1024)
  } catch {
    // Process might have exited
    return 0
  }
}

// Kill process tree cross-platform
export function killProcessTree(pid) {
  try {
    if (WIN32) {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      })
    } else {
      // macOS/Linux: Kill process group
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // Fallback to regular kill
        process.kill(pid, 'SIGKILL')
      }
      // Also kill any child processes
      spawnSync('pkill', ['-9', '-P', String(pid)], { stdio: 'ignore' })
    }
  } catch (e) {
    logger.error(`Error killing process: ${errorMessage(e)}`)
  }
}

// Memory monitor
const monitorInterval = setInterval(() => {
  if (killed) {
    clearInterval(monitorInterval)
    return
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000)

  // Check timeout
  if (Date.now() - startTime > TIMEOUT_MS) {
    logger.error(
      `TIMEOUT: Test exceeded ${TIMEOUT_MS / 1000}s - killing process`,
    )
    killed = true
    killProcessTree(vitestProcess.pid)
    clearInterval(monitorInterval)
    process.exitCode = 124
    return
  }

  // Check memory usage
  const memoryMB = getMemoryUsageMB(vitestProcess.pid)

  if (memoryMB > MAX_MEMORY_MB) {
    logger.error(
      `MEMORY LIMIT EXCEEDED: ${memoryMB}MB > ${MAX_MEMORY_MB}MB - killing process`,
    )
    killed = true
    killProcessTree(vitestProcess.pid)
    clearInterval(monitorInterval)
    process.exitCode = 125
    return
  }

  // Show progress (only if memory is being used). Direct stdout
  // write is intentional here: this is a TTY progress bar that
  // overwrites itself with `\r`; piping through a logger would
  // newline-terminate each frame and flood the output.
  if (memoryMB > 0) {
    const memPercent = Math.floor((memoryMB / MAX_MEMORY_MB) * 100)
    const bar = '\u2588'.repeat(Math.floor(memPercent / 5))
    const empty = '\u2591'.repeat(20 - Math.floor(memPercent / 5))
    const status = `\r Memory: ${memoryMB}MB / ${MAX_MEMORY_MB}MB [${bar}${empty}] ${memPercent}% | ${elapsed}s`
    process.stdout.write(status) // socket-hook: allow console -- TTY progress bar with \r overwrite
  }
}, CHECK_INTERVAL_MS)

// Handle vitest exit and errors
vitestPromise
  .then(result => {
    clearInterval(monitorInterval)
    if (!killed) {
      logger.log(`\n\nTest completed with exit code: ${result.code}`)
      process.exitCode = result.code || 0
    }
  })
  .catch(error => {
    clearInterval(monitorInterval)
    if (!killed) {
      logger.error('')
      logger.error(`Test failed: ${errorMessage(error)}`)
      process.exitCode = error.code || 1
    }
  })

// Handle Ctrl+C
process.on('SIGINT', () => {
  logger.log('')
  logger.log('Interrupted by user - cleaning up...')
  killed = true
  killProcessTree(vitestProcess.pid)
  clearInterval(monitorInterval)
  process.exitCode = 130
})

process.on('SIGTERM', () => {
  killed = true
  killProcessTree(vitestProcess.pid)
  clearInterval(monitorInterval)
  process.exitCode = 143
})

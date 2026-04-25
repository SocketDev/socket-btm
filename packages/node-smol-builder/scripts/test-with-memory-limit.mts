#!/usr/bin/env node
/**
 * Cross-platform memory-limited test runner
 * Usage: node scripts/test-with-memory-limit.mts [vitest args...]
 */

import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn, spawnSync } from '@socketsecurity/lib/spawn'
import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

const MAX_MEMORY_MB = 2048 // 2GB limit
const CHECK_INTERVAL_MS = 1000 // Check every 1 second
const TIMEOUT_MS = 120_000 // 2 minute timeout (120 seconds)

const vitestArgs = process.argv.slice(2)

logger.log(`Memory limit: ${MAX_MEMORY_MB}MB | Timeout: ${TIMEOUT_MS / 1000}s`)
logger.log(`Running: vitest ${vitestArgs.join(' ')}\n`)

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
function getMemoryUsageMB(pid) {
  try {
    if (WIN32) {
      // Windows: Use PowerShell (wmic is deprecated/removed on Windows 11+)
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-Process -Id ${pid}).WorkingSet64`,
        ],
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
function killProcessTree(pid) {
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

  // Show progress (only if memory is being used)
  if (memoryMB > 0) {
    const memPercent = Math.floor((memoryMB / MAX_MEMORY_MB) * 100)
    const bar = '\u2588'.repeat(Math.floor(memPercent / 5))
    const empty = '\u2591'.repeat(20 - Math.floor(memPercent / 5))
    process.stdout.write(
      `\r Memory: ${memoryMB}MB / ${MAX_MEMORY_MB}MB [${bar}${empty}] ${memPercent}% | ${elapsed}s`,
    )
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
      logger.error(`\nTest failed: ${errorMessage(error)}`)
      process.exitCode = error.code || 1
    }
  })

// Handle Ctrl+C
process.on('SIGINT', () => {
  logger.log('\n\nInterrupted by user - cleaning up...')
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

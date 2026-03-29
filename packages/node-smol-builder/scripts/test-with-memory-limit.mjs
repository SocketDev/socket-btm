#!/usr/bin/env node
/**
 * Cross-platform memory-limited test runner
 * Usage: node scripts/test-with-memory-limit.mjs [vitest args...]
 */

import { spawn } from '@socketsecurity/lib/spawn'
import process from 'node:process'

const MAX_MEMORY_MB = 2048 // 2GB limit
const CHECK_INTERVAL_MS = 1000 // Check every 1 second
const TIMEOUT_MS = 120000 // 2 minute timeout (120 seconds)

const vitestArgs = process.argv.slice(2)

console.log(`🔒 Memory limit: ${MAX_MEMORY_MB}MB | Timeout: ${TIMEOUT_MS / 1000}s`)
console.log(`📋 Running: vitest ${vitestArgs.join(' ')}\n`)

// Spawn vitest process using @socketsecurity/lib spawn
const vitestPromise = spawn(
  'pnpm',
  ['exec', 'vitest', 'run', ...vitestArgs],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: `--max-old-space-size=${MAX_MEMORY_MB}`,
    },
  },
)

const vitestProcess = vitestPromise.process

const startTime = Date.now()
let killed = false

// Get memory usage cross-platform
function getMemoryUsageMB(pid) {
  try {
    if (process.platform === 'win32') {
      // Windows: Use wmic
      const { execSync } = require('node:child_process')
      const output = execSync(
        `wmic process where processid=${pid} get WorkingSetSize`,
        { encoding: 'utf8' },
      )
      const lines = output.trim().split('\n')
      if (lines.length > 1) {
        const bytes = parseInt(lines[1].trim(), 10)
        return Math.floor(bytes / 1024 / 1024)
      }
    } else {
      // macOS/Linux: Use ps
      const { execSync } = require('node:child_process')
      const output = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' })
      const kb = parseInt(output.trim(), 10)
      return Math.floor(kb / 1024)
    }
  } catch (error) {
    // Process might have exited
    return 0
  }
  return 0
}

// Kill process tree cross-platform
function killProcessTree(pid) {
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('node:child_process')
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' })
    } else {
      // macOS/Linux: Use pkill
      const { execSync } = require('node:child_process')
      // Kill process group
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // Fallback to regular kill
        process.kill(pid, 'SIGKILL')
      }
      // Also kill any child processes
      try {
        execSync(`pkill -9 -P ${pid}`, { stdio: 'ignore' })
      } catch {
        // Ignore errors
      }
    }
  } catch (error) {
    console.error('Error killing process:', error.message)
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
    console.error(
      `\n⚠️  TIMEOUT: Test exceeded ${TIMEOUT_MS / 1000}s - killing process`,
    )
    killed = true
    killProcessTree(vitestProcess.pid)
    clearInterval(monitorInterval)
    process.exit(124)
    return
  }

  // Check memory usage
  const memoryMB = getMemoryUsageMB(vitestProcess.pid)

  if (memoryMB > MAX_MEMORY_MB) {
    console.error(
      `\n⚠️  MEMORY LIMIT EXCEEDED: ${memoryMB}MB > ${MAX_MEMORY_MB}MB - killing process`,
    )
    killed = true
    killProcessTree(vitestProcess.pid)
    clearInterval(monitorInterval)
    process.exit(125)
    return
  }

  // Show progress (only if memory is being used)
  if (memoryMB > 0) {
    const memPercent = Math.floor((memoryMB / MAX_MEMORY_MB) * 100)
    const bar = '█'.repeat(Math.floor(memPercent / 5))
    const empty = '░'.repeat(20 - Math.floor(memPercent / 5))
    process.stdout.write(
      `\r💾 Memory: ${memoryMB}MB / ${MAX_MEMORY_MB}MB [${bar}${empty}] ${memPercent}% | ⏱️  ${elapsed}s`,
    )
  }
}, CHECK_INTERVAL_MS)

// Handle vitest exit and errors
vitestPromise
  .then(result => {
    clearInterval(monitorInterval)
    if (!killed) {
      console.log(`\n\n✅ Test completed with exit code: ${result.code}`)
      process.exit(result.code || 0)
    }
  })
  .catch(error => {
    clearInterval(monitorInterval)
    if (!killed) {
      console.error('\n❌ Test failed:', error.message)
      process.exit(error.code || 1)
    }
  })

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n🛑 Interrupted by user - cleaning up...')
  killed = true
  killProcessTree(vitestProcess.pid)
  clearInterval(monitorInterval)
  process.exit(130)
})

process.on('SIGTERM', () => {
  killed = true
  killProcessTree(vitestProcess.pid)
  clearInterval(monitorInterval)
  process.exit(143)
})

#!/usr/bin/env node
/**
 * Orchestrated build script for socket-btm monorepo.
 *
 * Build order:
 * 1. LIEF (bin-infra) - must be first
 * 2. Binsuite (binpress, binflate, binject) - depends on LIEF, builds in parallel
 * 3. Node-smol-builder (depends on binsuite) - builds sequentially after binsuite
 * 4. WASM builds (onnxruntime-builder, yoga-layout-builder) - independent, run in parallel with everything
 * 5. Models (depends on onnxruntime-builder) - builds after onnxruntime completes
 */

import { spawn as nodeSpawn } from 'node:child_process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()
const WIN32 = process.platform === 'win32'

/**
 * Run a pnpm command.
 * @param {string[]} args - Arguments to pass to pnpm
 * @returns {Promise<void>}
 */
function runPnpm(args) {
  return new Promise((resolve, reject) => {
    const proc = nodeSpawn('pnpm', args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: WIN32,
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(`pnpm ${args.join(' ')} failed with exit code ${code}`),
        )
      }
    })

    proc.on('error', err => {
      reject(err)
    })
  })
}

/**
 * Run multiple pnpm commands in parallel.
 * @param {Array<{filter: string, script: string}>} tasks - Tasks to run
 * @returns {Promise<void>}
 * @throws {Error} If any task fails
 */
async function runParallel(tasks) {
  const promises = tasks.map(({ filter, script }) =>
    runPnpm(['--filter', filter, script]),
  )
  const results = await Promise.allSettled(promises)

  // Check for failures and collect error messages.
  const failures = results
    .map((result, i) => ({ result, task: tasks[i] }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, task }) => `${task.filter}: ${result.reason.message}`)

  if (failures.length > 0) {
    throw new Error(`Parallel tasks failed:\n${failures.join('\n')}`)
  }
}

async function main() {
  try {
    logger.log('Building socket-btm monorepo...\n')

    // Step 1: Build LIEF (required by binsuite).
    logger.info('[1/5] Building LIEF...')
    await runPnpm(['--filter', 'bin-infra', 'build:lief'])
    logger.success('LIEF built\n')

    // Step 2: Build binsuite in parallel (depends on LIEF).
    // Also start WASM builds in parallel (independent of everything else).
    logger.info('[2/5] Building binsuite and WASM packages in parallel...')
    logger.log('  - Binsuite: binpress, binflate, binject')
    logger.log('  - WASM: onnxruntime, yoga\n')

    const results = await Promise.allSettled([
      // Binsuite builds (binpress, binflate, binject)
      runParallel([
        { filter: 'binpress', script: 'build' },
        { filter: 'binflate', script: 'build' },
        { filter: 'binject', script: 'build' },
      ]),
      // WASM builds (onnxruntime, yoga)
      runParallel([
        { filter: 'onnxruntime-builder', script: 'build' },
        { filter: 'yoga-layout-builder', script: 'build' },
      ]),
    ])

    // Check for failures
    const [binsuiteResult, wasmResult] = results
    const failures = []

    if (binsuiteResult.status === 'rejected') {
      const err = binsuiteResult.reason
      failures.push(`Binsuite: ${err.stack || err.message || err}`)
    } else {
      logger.success('Binsuite built')
    }

    if (wasmResult.status === 'rejected') {
      const err = wasmResult.reason
      failures.push(`WASM: ${err.stack || err.message || err}`)
    } else {
      logger.success('WASM packages built')
    }

    logger.log('')

    if (failures.length > 0) {
      throw new Error(
        `Parallel builds failed:\n${failures.map(f => `  - ${f}`).join('\n')}`,
      )
    }

    // Step 3: Build node-smol-builder (depends on binsuite).
    logger.info('[3/5] Building node-smol-builder...')
    await runPnpm(['--filter', 'node-smol-builder', 'build'])
    logger.success('Node-smol-builder built\n')

    // Step 4: Build models (depends on onnxruntime which is already built).
    logger.info('[4/5] Building models...')
    await runPnpm(['--filter', 'models', 'build'])
    logger.success('Models built\n')

    logger.success('All builds completed successfully!')
  } catch (error) {
    logger.fail(`Build failed: ${error?.message || 'Unknown error'}`)

    process.exit(1)
  }
}

main()

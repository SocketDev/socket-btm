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

import { spawn } from 'node:child_process'

const WIN32 = process.platform === 'win32'

/**
 * Run a pnpm command.
 * @param {string[]} args - Arguments to pass to pnpm
 * @returns {Promise<void>}
 */
function runPnpm(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', args, {
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
 */
async function runParallel(tasks) {
  const promises = tasks.map(({ filter, script }) =>
    runPnpm(['--filter', filter, script]),
  )
  await Promise.allSettled(promises)
}

async function main() {
  try {
    console.log('🔨 Building socket-btm monorepo...\n')

    // Step 1: Build LIEF (required by binsuite)
    console.log('📦 [1/5] Building LIEF...')
    await runPnpm(['--filter', 'bin-infra', 'build:lief'])
    console.log('✅ LIEF built\n')

    // Step 2: Build binsuite in parallel (depends on LIEF)
    // Also start WASM builds in parallel (independent of everything else)
    console.log('📦 [2/5] Building binsuite and WASM packages in parallel...')
    console.log('  - Binsuite: binpress, binflate, binject')
    console.log('  - WASM: onnxruntime, yoga\n')

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
      failures.push(`Binsuite: ${binsuiteResult.reason.message}`)
    } else {
      console.log('✅ Binsuite built')
    }

    if (wasmResult.status === 'rejected') {
      failures.push(`WASM: ${wasmResult.reason.message}`)
    } else {
      console.log('✅ WASM packages built')
    }

    console.log('')

    if (failures.length > 0) {
      throw new Error(
        `Parallel builds failed:\n${failures.map(f => `  - ${f}`).join('\n')}`,
      )
    }

    // Step 3: Build node-smol-builder (depends on binsuite)
    console.log('📦 [3/5] Building node-smol-builder...')
    await runPnpm(['--filter', 'node-smol-builder', 'build'])
    console.log('✅ Node-smol-builder built\n')

    // Step 4: Build models (depends on onnxruntime which is already built)
    console.log('📦 [4/5] Building models...')
    await runPnpm(['--filter', 'models', 'build'])
    console.log('✅ Models built\n')

    console.log('🎉 All builds completed successfully!')
  } catch (error) {
    console.error('\n❌ Build failed:', error.message)

    process.exit(1)
  }
}

main()

#!/usr/bin/env node
/**
 * Orchestrated build script for socket-btm monorepo.
 *
 * Build order:
 * 1. LIEF (lief-builder) - must be first
 * 2. Binsuite (binpress, binflate, binject) - depends on LIEF, builds in parallel
 * 3. Node-smol-builder (depends on binsuite) - builds sequentially after binsuite
 * 4. WASM builds (onnxruntime-builder, yoga-layout-builder) - independent, run in parallel with everything
 * 5. Models (depends on onnxruntime-builder) - builds after onnxruntime completes
 */
import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

type PnpmTask = {
  filter: string
  script: string
}

/**
 * Run multiple pnpm commands in parallel.
 * @param {Array<{filter: string, script: string}>} tasks - Tasks to run
 * @returns {Promise<void>}
 * @throws {Error} If any task fails
 */
export async function runParallel(tasks: PnpmTask[]): Promise<void> {
  const promises = tasks.map(({ filter, script }) =>
    runPnpm(['--filter', filter, script]),
  )
  const results = await Promise.allSettled(promises)

  // Check for failures and collect error messages.
  const failures = results
    .map((result, i) => ({ result, task: tasks[i]! }))
    .filter(
      (
        entry,
      ): entry is {
        result: PromiseRejectedResult
        task: PnpmTask
      } => entry.result.status === 'rejected',
    )
    .map(({ result, task }) => {
      const reason = result.reason as Error
      return `${task.filter}: ${reason.message}`
    })

  if (failures.length > 0) {
    throw new Error(`Parallel tasks failed:\n${failures.join('\n')}`)
  }
}

/**
 * Run a pnpm command.
 * @param {string[]} args - Arguments to pass to pnpm
 * @returns {Promise<void>}
 */
export async function runPnpm(args: string[]): Promise<void> {
  try {
    await spawn('pnpm', args, {
      // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- propagating cwd to a pnpm child invocation; the user-invoked cwd IS the right cwd to forward
      cwd: process.cwd(),
      shell: WIN32,
      stdio: 'inherit',
    })
  } catch (e) {
    const error = e as { exitCode?: number | undefined }
    throw new Error(
      `pnpm ${args.join(' ')} failed with exit code ${error.exitCode || 'unknown'}`,
      { cause: error },
    )
  }
}

async function main(): Promise<void> {
  try {
    logger.log('Building socket-btm monorepo…')
    logger.log('')

    // curl + LIEF have no socket-btm prerequisites and both feed stubs
    // (LIEF is also linked into node-smol); build them concurrently.
    logger.info('[1/6] Building curl + LIEF in parallel…')
    {
      const [curlResult, liefResult] = await Promise.allSettled([
        runPnpm(['--filter', 'curl-builder', 'build']),
        runPnpm(['--filter', 'lief-builder', 'build']),
      ])
      const failures: string[] = []
      if (curlResult.status === 'rejected') {
        failures.push(`curl: ${errorMessage(curlResult.reason)}`)
      }
      if (liefResult.status === 'rejected') {
        failures.push(`LIEF: ${errorMessage(liefResult.reason)}`)
      }
      if (failures.length > 0) {
        throw new Error(
          `curl/LIEF build failed:\n${failures.map(f => `  - ${f}`).join('\n')}`,
        )
      }
    }
    logger.success('curl + LIEF built')
    logger.error('')

    // stubs links curl + LIEF; binpress embeds the resulting stub binaries,
    // so stubs MUST finish before binsuite or binpress falls back to
    // downloading released stubs instead of the locally-built ones.
    logger.info('[2/6] Building stubs (links curl + LIEF)...')
    await runPnpm(['--filter', 'stubs-builder', 'build'])
    logger.success('Stubs built')
    logger.error('')

    // Binsuite (binpress embeds stubs) runs alongside the WASM builders,
    // which share no dependencies with the curl→stubs→binsuite chain.
    logger.info('[3/6] Building binsuite and WASM packages in parallel…')
    logger.log('  - Binsuite: binpress, binflate, binject')
    logger.log('  - WASM: onnxruntime, yoga')
    logger.log('')

    const results = await Promise.allSettled([
      runParallel([
        { filter: 'binpress', script: 'build' },
        { filter: 'binflate', script: 'build' },
        { filter: 'binject', script: 'build' },
      ]),
      runParallel([
        { filter: 'onnxruntime-builder', script: 'build' },
        { filter: 'yoga-layout-builder', script: 'build' },
      ]),
    ])

    const [binsuiteResult, wasmResult] = results
    const failures: string[] = []

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

    // node-smol SEA-injects the binsuite output + links curl/LIEF.
    logger.info('[4/6] Building node-smol-builder (consumes binsuite)...')
    await runPnpm(['--filter', 'node-smol-builder', 'build'])
    logger.success('Node-smol-builder built')
    logger.error('')

    // Models run the ONNX export + quantization through onnxruntime.
    logger.info('[5/6] Building models (consumes onnxruntime)...')
    await runPnpm(['--filter', 'models', 'build'])
    logger.success('Models built')
    logger.error('')

    logger.success('All builds completed successfully!')
  } catch (e) {
    logger.fail(`Build failed: ${errorMessage(e)}`)
    logger.log('')
    logger.info('To rebuild a specific package: pnpm --filter <package> build')
    logger.info(
      'To see verbose output: pnpm --filter <package> build --verbose',
    )

    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error('Unexpected error:', e)
  process.exitCode = 1
})

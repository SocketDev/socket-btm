/* oxlint-disable socket/sort-source-methods -- helpers grouped by builtin probe (probe → assert → describe); alphabetizing would split each builtin's helper triplet. */
/**
 * @fileoverview Shared helpers for probing `node:smol-*` builtins on
 * the built smol binary. Every `node:smol-*` integration test uses the
 * same probe-and-skip pattern: if the Final/ binary doesn't have the
 * binding wired in (built before the relevant patches landed, or
 * built with that binding stripped), skip rather than fail — the
 * build itself is the contract under test, and a rebuild re-enables
 * the suite automatically.
 */

import { existsSync } from 'node:fs'

import { spawn, spawnSync } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mts'

const PROBE_TIMEOUT_MS = 10_000

/**
 * Resolve the latest Final/ binary path or `undefined` if no build
 * exists. Tests use the `undefined` case to compute their `skipIf`.
 */
export function resolveFinalBinary(): string | undefined {
  const finalBinaryPath = getLatestFinalBinary()
  if (!finalBinaryPath || !existsSync(finalBinaryPath)) {
    return undefined
  }
  return finalBinaryPath
}

/**
 * Synchronously probe whether the Final/ binary reports
 * `isBuiltin('node:<name>')` as `true`. Used at the top level of
 * integration test files to compute `skipIf` before `describe`.
 *
 * Sync rather than async because vitest's `describe.skipIf` needs the
 * value resolved before the suite is registered.
 *
 * Probes only the `node:`-prefixed form. Bare `<name>` is in
 * schemelessBlockList and always returns false from isBuiltin even
 * when the module is wired in — the prefixed form is the source of
 * truth.
 */
export function smolBuiltinIsAvailable(name: string): boolean {
  const finalBinaryPath = resolveFinalBinary()
  if (!finalBinaryPath) {
    return false
  }
  try {
    const result = spawnSync(
      finalBinaryPath,
      [
        '-e',
        `process.stdout.write(String(require("node:module").isBuiltin("node:${name}")))`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: PROBE_TIMEOUT_MS },
    )
    return String(result.stdout || '').trim() === 'true'
  } catch {
    return false
  }
}

export interface RunOptions {
  /** Override the default 10s timeout for slow setup paths. */
  timeoutMs?: number
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Run an inline JS script on the resolved Final/ binary. Returns
 * a normalized `{ code, stdout, stderr }` shape so test bodies can
 * assert on string output without per-test Buffer coercion.
 *
 * Throws if no Final/ binary exists — call sites should gate the
 * whole suite via `smolBuiltinIsAvailable()` first.
 */
export async function runOnSmolBinary(
  script: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const finalBinaryPath = resolveFinalBinary()
  if (!finalBinaryPath) {
    throw new Error(
      'runOnSmolBinary: no Final/ smol binary found — ' +
        'gate the suite with smolBuiltinIsAvailable() first',
    )
  }
  const result = await spawn(finalBinaryPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? PROBE_TIMEOUT_MS,
  })
  return {
    code: result.code,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  }
}

/**
 * Inline JS snippet that prints every public export name + typeof
 * for `require('node:<name>')`. Used by every integration suite to
 * lock the API surface — drift in either direction (added/removed
 * exports, or wrong typeof) is caught immediately.
 *
 * Output is one line per export: `export:<name>=<typeof>`.
 */
export function printExportShapeScript(name: string): string {
  return `
    const mod = require('node:${name}')
    const keys = Object.getOwnPropertyNames(mod).sort()
    for (const k of keys) {
      try {
        const v = mod[k]
        process.stdout.write('export:' + k + '=' + typeof v + '\\n')
      } catch (e) {
        process.stdout.write('export:' + k + '=ERR:' + (e && e.message || 'unknown') + '\\n')
      }
    }
  `
}

/**
 * Parse the output of `printExportShapeScript` into a Map of
 * export name → typeof string.
 */
export function parseExportShape(stdout: string): Map<string, string> {
  const shape = new Map<string, string>()
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const line of stdout.split('\n')) {
    const match = /^export:([^=]+)=(.*)$/.exec(line)
    if (match) {
      shape.set(match[1]!, match[2]!)
    }
  }
  return shape
}

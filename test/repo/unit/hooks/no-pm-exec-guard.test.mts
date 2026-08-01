/**
 * @file Contract coverage for the no-pm-exec-guard hook. Each case drives the
 *   hook as a real subprocess — a JSON payload on stdin, a verdict on stderr
 *   and in the exit code (0 = allow, 2 = block).
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
// prefer-async-spawn: streaming-stdio-required — the hook is exercised as a
// real subprocess so we observe its stdin/stdout/stderr contract.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(
  here,
  '..',
  '..',
  '..',
  '..',
  '.claude',
  'hooks',
  'fleet',
  'no-pm-exec-guard',
  'index.mts',
)

type Result = { code: number; stderr: string }

function makeTranscript(text: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'no-pm-exec-guard-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, `${JSON.stringify({ role: 'user', content: text })}\n`)
  return file
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify(payload))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return await new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

async function runHookRaw(raw: string): Promise<number> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(raw)
  return await new Promise(resolve => {
    child.process.on('exit', code => resolve(code ?? 0))
  })
}

it('non-Bash tool calls pass through', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: { file_path: 'foo.ts', new_string: 'bar' },
  })
  expect(result.code).toBe(0)
  expect(result.stderr).toBe('')
})

describe('wrapper exec form', () => {
  it.each([
    'pnpm exec vitest run foo.test.mts',
    'npm exec vitest run foo.test.mts',
    'yarn exec vitest run foo.test.mts',
  ])('blocks %s', async command => {
    const result = await runHook({
      tool_name: 'Bash',
      tool_input: { command },
    })
    expect(result.code).toBe(2)
    expect(result.stderr).toMatch(/Blocked: `(?:pnpm|npm|yarn) exec`/)
    expect(result.stderr).toMatch(/node_modules\/\.bin\/<tool>/)
  })
})

describe('fetch-and-run form', () => {
  it.each(['pnpm dlx vitest', 'yarn dlx vitest', 'npx vitest', 'pnx vitest'])(
    'blocks %s',
    async command => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command },
      })
      expect(result.code).toBe(2)
      expect(result.stderr).toMatch(/FETCHES \+ executes unpinned code/)
      expect(result.stderr).toMatch(/node_modules\/\.bin\/<tool>/)
    },
  )
})

it('direct local bin invocation passes', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'node_modules/.bin/vitest run foo.test.mts' },
  })
  expect(result.code).toBe(0)
  expect(result.stderr).toBe('')
})

it('bypass phrase allows a blocked command', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pnpm exec vitest run foo.test.mts' },
    transcript_path: makeTranscript(
      'Please Allow pm-exec bypass for this run.',
    ),
  })
  expect(result.code).toBe(0)
  expect(result.stderr).toBe('')
})

it('malformed payload fails open', async () => {
  const code = await runHookRaw('{ not json')
  expect(code).toBe(0)
})

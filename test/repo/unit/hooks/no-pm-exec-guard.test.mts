import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
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

test('non-Bash tool calls pass through', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: { file_path: 'foo.ts', new_string: 'bar' },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

for (const command of [
  'pnpm exec vitest run foo.test.mts',
  'npm exec vitest run foo.test.mts',
  'yarn exec vitest run foo.test.mts',
] as const) {
  test(`blocks wrapper exec form: ${command}`, async () => {
    const result = await runHook({
      tool_name: 'Bash',
      tool_input: { command },
    })
    assert.strictEqual(result.code, 2)
    assert.match(result.stderr, /Blocked: `(?:pnpm|npm|yarn) exec`/)
    assert.match(result.stderr, /shared local-bin helper/)
  })
}

for (const command of [
  'pnpm dlx vitest',
  'yarn dlx vitest',
  'npx vitest',
  'pnx vitest',
] as const) {
  test(`blocks fetch-and-run form: ${command}`, async () => {
    const result = await runHook({
      tool_name: 'Bash',
      tool_input: { command },
    })
    assert.strictEqual(result.code, 2)
    assert.match(result.stderr, /FETCHES \+ executes unpinned code/)
    assert.match(result.stderr, /shared local-bin helper/)
  })
}

test('direct local bin invocation passes', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'node_modules/.bin/vitest run foo.test.mts' },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('bypass phrase allows a blocked command', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pnpm exec vitest run foo.test.mts' },
    transcript_path: makeTranscript(
      'Please Allow pm-exec bypass for this run.',
    ),
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('malformed payload fails open', async () => {
  const code = await runHookRaw('{ not json')
  assert.strictEqual(code, 0)
})

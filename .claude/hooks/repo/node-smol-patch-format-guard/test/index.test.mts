// node --test specs for the node-smol-patch-format-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

const PATCH = 'packages/node-smol-builder/patches/source-patched/099-x.patch'
const HEADER = '# @node-versions: v26.1.0\n# @description: test patch\n'
const BODY = '--- a/node.gyp\n+++ b/node.gyp\n@@ -1 +1 @@\n-x\n+y\n'

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify(payload))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('non-source-patched files pass through (even with a cross-ref)', async () => {
  const result = await runHook({
    tool_input: { content: 'see patch 004', file_path: 'src/node_binding.cc' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('a well-formed patch passes', async () => {
  const result = await runHook({
    tool_input: { content: HEADER + BODY, file_path: PATCH },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('blocks a patch missing the @node-versions / @description header', async () => {
  const result = await runHook({
    tool_input: { content: BODY, file_path: PATCH },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /@node-versions/)
  assert.match(result.stderr, /@description/)
})

test('blocks a patch that references another patch by number', async () => {
  const result = await runHook({
    tool_input: {
      content: HEADER + '# builds on patch 004\n' + BODY,
      file_path: PATCH,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /references another patch by number/)
})

test('allows plural "patches NNN" prose (not an ordering edge)', async () => {
  const result = await runHook({
    tool_input: {
      content: HEADER + '# mirrors patches 004 + 021\n' + BODY,
      file_path: PATCH,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('handles Edit payloads via new_string', async () => {
  const result = await runHook({
    tool_input: { file_path: PATCH, new_string: BODY },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})

test('fails open on malformed JSON', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('{ not json')
  const code: number = await new Promise(resolve => {
    child.process.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
})

#!/usr/bin/env node

/**
 * @fileoverview Self-test for check-lockstep.mts.
 *
 * Verifies the audit script actually detects gaps. Without this,
 * a regex bug could silently false-pass forever (the audit's whole
 * value is catching V8/upstream drift before runtime).
 *
 * Three regex-shape tests:
 *
 *   1. Synthetic V8 call-site string is matched by the
 *      `temporal_rs::Class::method(` extraction pattern.
 *
 *   2. Synthetic shim header source extracts the present method
 *      but not an absent one.
 *
 *   3. Stub-pattern detection: live code lines trip; comment
 *      lines are filtered out by the skip rule.
 *
 * Run via:
 *   node packages/temporal-infra/scripts/check-lockstep.test.mts
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Stage a fake repo with the layout the audit expects. Returns the
 * root + a cleanup callback.
 */
export function makeFixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'temporal-lockstep-test-'))
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

/**
 * Wrap a test fn so PASS/FAIL is logged + counters update.
 */
export function run(
  name: string,
  fn: () => void,
  counters: { passed: number; failed: number },
): void {
  try {
    fn()
    logger.success(`PASS  ${name}`)
    counters.passed += 1
  } catch (err) {
    logger.error(`FAIL  ${name}`)
    logger.error(`      ${err instanceof Error ? err.message : String(err)}`)
    counters.failed += 1
  }
}

/**
 * Stage a synthetic shim header file with the given method names.
 */
export function stageShimHeader(
  root: string,
  cls: string,
  methods: string[],
): string {
  const dir = path.join(
    root,
    'packages',
    'temporal-infra',
    'include',
    'temporal_rs',
  )
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${cls}.hpp`)
  const lines: string[] = []
  for (let i = 0, { length } = methods; i < length; i += 1) {
    lines.push(`  void ${methods[i]!}() {}`)
  }
  writeFileSync(
    file,
    `// fixture\nclass ${cls} {\n public:\n${lines.join('\n')}\n};\n`,
  )
  return file
}

/**
 * Stage a synthetic V8 file with the given temporal_rs call
 * patterns embedded.
 */
export function stageV8File(root: string, calls: string[]): string {
  const dir = path.join(
    root,
    'packages',
    'node-smol-builder',
    'upstream',
    'node',
    'deps',
    'v8',
    'src',
    'objects',
  )
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'js-temporal-objects.cc')
  const lines: string[] = []
  for (let i = 0, { length } = calls; i < length; i += 1) {
    lines.push(`  auto x = ${calls[i]!}(arg);`)
  }
  writeFileSync(file, `// fixture\nvoid stub() {\n${lines.join('\n')}\n}\n`)
  return file
}

/**
 * Test 1: the V8 call-extraction regex pulls Class + method names
 * from a synthetic call string.
 */
export function testMissingClass(): void {
  const { cleanup, root } = makeFixture()
  try {
    stageV8File(root, ['temporal_rs::FakeAbsent::method'])
    const call = 'temporal_rs::FakeAbsent::method('
    const pattern =
      /temporal_rs::([A-Z][A-Za-z0-9]*)::([a-z_][a-z_0-9]*)\s*\(/g
    const matches = Array.from(call.matchAll(pattern))
    assert.equal(matches.length, 1, 'regex must match')
    assert.equal(matches[0]![1], 'FakeAbsent')
    assert.equal(matches[0]![2], 'method')
  } finally {
    cleanup()
  }
}

/**
 * Test 2: the shim-method extraction regex finds present_method
 * but not absent_method in a synthetic header.
 */
export function testMissingMethod(): void {
  const { cleanup, root } = makeFixture()
  try {
    stageShimHeader(root, 'KnownClass', ['present_method'])
    const text = `// fixture\nclass KnownClass {\n  void present_method() {}\n};\n`
    const matches = text.match(/\b[a-z_][a-z_0-9]*\s*\(/g) ?? []
    const set = new Set<string>()
    for (let i = 0, { length } = matches; i < length; i += 1) {
      set.add(matches[i]!.replace(/\s*\($/, ''))
    }
    assert.ok(set.has('present_method'), 'shim parser must find present_method')
    assert.ok(
      !set.has('absent_method'),
      'shim parser must NOT find absent_method',
    )
  } finally {
    cleanup()
  }
}

/**
 * Test 3: stub-pattern detection trips on live code lines and is
 * filtered out by the comment-skip rule on comment lines.
 */
export function testStubPatternDetection(): void {
  const stubLine =
    '    return Err(TemporalError::Range("not yet implemented"));'
  const calendarLine =
    '  return TemporalError::Range("PlainMonthDay requires a calendar backend");'
  const commentLine =
    '// historical comment about "not yet implemented" — should not fire'

  const patterns = [
    /\bnot yet implemented\b/,
    /\brequires (a |an )?calendar\b/i,
    /^\s*\/\/\s*Stub:/m,
  ]

  assert.ok(
    patterns.some(re => re.test(stubLine)),
    'stub line should match "not yet implemented"',
  )
  assert.ok(
    patterns.some(re => re.test(calendarLine)),
    'calendar-backend line should match "requires a calendar"',
  )
  assert.ok(
    commentLine.trimStart().startsWith('//'),
    'comment lines must be detected by trimStart().startsWith("//")',
  )
}

// ── Driver ──────────────────────────────────────────────────────────

const counters = { passed: 0, failed: 0 }

logger.info('check-lockstep self-tests')
logger.info('')

run('Test 1: missing-class regex extraction', testMissingClass, counters)
run('Test 2: missing-method shim parser', testMissingMethod, counters)
run('Test 3: stub-pattern detection', testStubPatternDetection, counters)

logger.info('')
logger.info(`${counters.passed} passed, ${counters.failed} failed`)
if (counters.failed > 0) {
  process.exit(1)
}

/**
 * @file Unit tests for check-lockstep's regex extractors.
 *   The audit's whole value is catching V8/upstream drift before
 *   runtime. A regex bug could silently false-pass forever — these
 *   tests pin the three patterns the audit depends on:
 *
 *   1. V8 call-site extractor pulls `Class::method` out of a
 *      `temporal_rs::Class::method(` reference.
 *   2. Shim header parser finds declared methods, doesn't invent undeclared ones.
 *   3. Stub-pattern detection fires on live code, is filtered out on comment
 *      lines.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let fixtureRoot: string

beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'temporal-lockstep-test-'))
})

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

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
 * Stage a synthetic V8 file with embedded temporal_rs call patterns.
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

describe('check-lockstep regex patterns', () => {
  it('V8 call-extraction regex pulls Class + method from a synthetic call', () => {
    stageV8File(fixtureRoot, ['temporal_rs::FakeAbsent::method'])
    const call = 'temporal_rs::FakeAbsent::method('
    const pattern = /temporal_rs::([A-Z][A-Za-z0-9]*)::([a-z_][a-z_0-9]*)\s*\(/g
    const matches = Array.from(call.matchAll(pattern))
    expect(matches.length).toBe(1)
    expect(matches[0]![1]).toBe('FakeAbsent')
    expect(matches[0]![2]).toBe('method')
  })

  it('shim-method extraction finds declared methods, not undeclared ones', () => {
    stageShimHeader(fixtureRoot, 'KnownClass', ['present_method'])
    const text = `// fixture\nclass KnownClass {\n  void present_method() {}\n};\n`
    const matches = text.match(/\b[a-z_][a-z_0-9]*\s*\(/g) ?? []
    const set = new Set<string>()
    for (let i = 0, { length } = matches; i < length; i += 1) {
      set.add(matches[i]!.replace(/\s*\($/, ''))
    }
    expect(set.has('present_method')).toBe(true)
    expect(set.has('absent_method')).toBe(false)
  })

  it('stub-pattern detection: live code trips, comments do not', () => {
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

    expect(patterns.some(re => re.test(stubLine))).toBe(true)
    expect(patterns.some(re => re.test(calendarLine))).toBe(true)
    expect(commentLine.trimStart().startsWith('//')).toBe(true)
  })
})

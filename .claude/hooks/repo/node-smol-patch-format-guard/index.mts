#!/usr/bin/env node
// Claude Code PreToolUse hook — node-smol-patch-format-guard (socket-btm repo-local).
//
// Blocks Edit/Write of an upstream-Node patch under
// `packages/node-smol-builder/patches/source-patched/*.patch` that violates the
// patch invariants enforced by test/patches/validate-patches.test.mts — so the
// rule fails at edit time, not just in CI:
//
//   1. Header: the patch must carry `# @node-versions:` AND `# @description:`
//      lines (the fleet patch-header format; consumed by apply-patches.mts).
//   2. No cross-patch reference: the patch content must not mention another
//      patch by number ("patch 004" / "Patch 018"). Patches apply in any order
//      (the suite enforces zero file-overlap), so naming a sibling patch implies
//      a false ordering dependency — describe the wiring/file instead.
//
// This is repo-local (lives under .claude/hooks/repo/, NOT cascaded to the
// fleet) because source-patched/ exists only in socket-btm.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Exit codes:
//   0 — pass (not a source-patched patch, or content is well-formed).
//   2 — block (missing header line, or a cross-patch reference).
//
// Fails OPEN on any hook bug (exit 0 + stderr log) — a guard must never brick
// the session on its own crash.

import process from 'node:process'

import {
  readFilePath,
  readWriteContent,
} from '../../fleet/_shared/payload.mts'

// Matches `.../packages/node-smol-builder/patches/source-patched/NNN-*.patch`.
const PATCH_PATH_RE =
  /packages\/node-smol-builder\/patches\/source-patched\/[^/]+\.patch$/

// A cross-patch reference: "patch 004" / "Patch 018" (singular `patch` + space +
// 3 digits). Plural "patches 004 + 021" is allowed (it reads as prose, not a
// dependency edge) — matching validate-patches.test.mts's own check.
const CROSS_REF_RE = /\b[Pp]atch \d{3}\b/

function main(): void {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', c => {
    raw += c
  })
  process.stdin.on('end', () => {
    try {
      let payload: unknown
      try {
        payload = JSON.parse(raw)
      } catch {
        process.exit(0)
      }
      const p = payload as {
        tool_name?: string
        tool_input?: unknown
      }
      if (p.tool_name !== 'Edit' && p.tool_name !== 'Write') {
        process.exit(0)
      }
      const filePath = readFilePath(p as never) ?? ''
      if (!PATCH_PATH_RE.test(filePath)) {
        process.exit(0)
      }
      const content = readWriteContent(p as never) ?? ''
      if (!content.trim()) {
        process.exit(0)
      }

      const problems: string[] = []
      if (!/^#\s*@node-versions:/m.test(content)) {
        problems.push('missing `# @node-versions:` header line')
      }
      if (!/^#\s*@description:/m.test(content)) {
        problems.push('missing `# @description:` header line')
      }
      const crossRef = CROSS_REF_RE.exec(content)
      if (crossRef) {
        problems.push(
          `references another patch by number ("${crossRef[0]}") — patches apply in any order; describe the wiring/file instead of naming a sibling patch`,
        )
      }

      if (problems.length === 0) {
        process.exit(0)
      }

      process.stderr.write(
        [
          '[node-smol-patch-format-guard] Blocked: source-patched patch is malformed',
          '',
          `  ${filePath}`,
          '',
          ...problems.map(p => `  - ${p}`),
          '',
          '  These are enforced by test/patches/validate-patches.test.mts',
          '  (pnpm test:node-smol). Fix the patch so it passes there.',
          '',
        ].join('\n'),
      )
      process.exit(2)
    } catch (e) {
      process.stderr.write(
        `[node-smol-patch-format-guard] hook error (allowing): ${e}\n`,
      )
      process.exit(0)
    }
  })
}

main()

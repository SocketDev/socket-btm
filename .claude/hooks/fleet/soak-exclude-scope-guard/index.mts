#!/usr/bin/env node
// Claude Code PreToolUse hook — soak-exclude-scope-guard.
//
// Blocks Edit/Write to `pnpm-workspace.yaml` that add a non-Socket-
// scoped entry to `minimumReleaseAgeExclude:`. The soak gate is
// malware protection; bypassing it for third-party packages
// weakens the policy without justification. Third-party version
// pins go in `overrides:` instead.
//
// Sibling guard: `soak-exclude-date-annotation-guard` enforces
// `# published: ... | removable: ...` annotations on entries. This
// guard is orthogonal — it restricts WHICH packages can appear at
// all, not how they're annotated.
//
// Bypass: `Allow soak-exclude-third-party bypass` typed verbatim.
//
// Fails open on YAML parse errors.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
        readonly old_string?: string | undefined
        readonly content?: string | undefined
      }
    | undefined
  readonly transcript_path?: string | undefined
}

const BYPASS_PHRASE = 'Allow soak-exclude-third-party bypass'

const ALLOWED_SCOPES = new Set([
  '@socketsecurity',
  '@socketregistry',
  '@socketbin',
  '@socketaddon',
])

const SECTION_HEADER = /^minimumReleaseAgeExclude:\s*$/
const ANY_TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:\s*(?:\S.*)?$/

// Match a per-entry bullet inside the block:
//   - '@scope/name@1.2.3'
//   - '@scope/name'         (scope glob — name part is '*')
//   - '@scope/*'            (glob)
//   - 'bare-name@1.2.3'
//   - 'bare-name'
// Quoted or unquoted. Captures group 1 = full entry (no quotes).
const ENTRY_RE = /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/

interface OffendingEntry {
  readonly line: number
  readonly entry: string
  readonly scope: string | null
}

export function isPnpmWorkspaceYaml(filePath: string): boolean {
  return path.basename(filePath) === 'pnpm-workspace.yaml'
}

// Extract every per-entry value inside `minimumReleaseAgeExclude:`.
// Returns a Map keyed by entry value (the raw package selector) →
// line number (1-indexed) where the entry sits in the file.
export function parseExcludeEntries(text: string): Map<string, number> {
  const out = new Map<string, number>()
  const lines = text.split('\n')
  let inBlock = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (SECTION_HEADER.test(line)) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    if (ANY_TOP_LEVEL_KEY.test(line)) {
      inBlock = false
      continue
    }
    const m = ENTRY_RE.exec(line)
    if (m) {
      out.set(m[1]!, i + 1)
    }
  }
  return out
}

// Pull the scope from an entry. Returns the scope token (e.g.
// `@socketsecurity`) or `null` for un-scoped entries (`defu`,
// `defu@6.1.6`).
export function entryScope(entry: string): string | null {
  if (!entry.startsWith('@')) {
    return null
  }
  const slash = entry.indexOf('/')
  if (slash < 0) {
    // `@scope` with no `/name` — malformed; treat as un-scoped.
    return null
  }
  return entry.slice(0, slash)
}

export function isAllowedScope(scope: string | null): boolean {
  return scope !== null && ALLOWED_SCOPES.has(scope)
}

export function readFileSafe(p: string): string {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    process.exit(0)
  }
  const input = payload.tool_input
  const filePath = input?.file_path
  if (!filePath || !isPnpmWorkspaceYaml(filePath)) {
    process.exit(0)
  }

  const currentText = readFileSafe(filePath)
  let afterText: string
  if (payload.tool_name === 'Write') {
    afterText = input?.content ?? input?.new_string ?? ''
  } else {
    const oldStr = input?.old_string ?? ''
    const newStr = input?.new_string ?? ''
    if (!oldStr) {
      process.exit(0)
    }
    if (!currentText.includes(oldStr)) {
      process.exit(0)
    }
    afterText = currentText.replace(oldStr, newStr)
  }

  let beforeEntries: Map<string, number>
  let afterEntries: Map<string, number>
  try {
    beforeEntries = parseExcludeEntries(currentText)
    afterEntries = parseExcludeEntries(afterText)
  } catch {
    process.exit(0)
  }

  const offending: OffendingEntry[] = []
  for (const [entry, line] of afterEntries) {
    if (beforeEntries.has(entry)) {
      continue
    }
    const scope = entryScope(entry)
    if (!isAllowedScope(scope)) {
      offending.push({ entry, line, scope })
    }
  }
  if (offending.length === 0) {
    process.exit(0)
  }
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    process.exit(0)
  }

  const lines: string[] = [
    '[soak-exclude-scope-guard] Blocked: non-Socket entry in minimumReleaseAgeExclude',
    '',
    `  File: ${filePath}`,
    '',
  ]
  for (const o of offending) {
    lines.push(`  • line ${o.line}: \`${o.entry}\``)
  }
  lines.push(
    '',
    '  `minimumReleaseAgeExclude:` is a security-policy bypass for Socket',
    '  first-party scopes only:',
    '',
    '    @socketsecurity/* @socketregistry/* @socketbin/* @socketaddon/*',
    '',
    '  Adding a third-party package weakens the malware-protection soak gate.',
    '',
    '  Fix: move the entry to `overrides:` in the same file. Overrides bypass',
    '  the soak check without weakening the policy:',
    '',
    '    overrides:',
    `      ${offending[0]!.entry.split('@')[0]}: '>=X.Y.Z'`,
    '',
    `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
    '',
  )
  process.stderr.write(lines.join('\n'))
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[soak-exclude-scope-guard] hook error (allowing): ${(e as Error).message}\n`,
  )
})

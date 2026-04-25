#!/usr/bin/env node
/**
 * @fileoverview Bug-class regression gate.
 *
 * Runs fast grep-based checks for the 9 bug classes caught during the
 * R14-R25 quality-scan rounds. Each class encodes a lesson learned:
 * the regex catches the shape of a real bug we've shipped before, and
 * the allowlist records the specific sites that were manually verified
 * safe.
 *
 * A PR that introduces a new instance of any class will fail this check
 * unless the author adds an allowlist entry with a justification.
 *
 * Usage:
 *   node scripts/check-bug-classes.mts             # Fail on any unknown match
 *   node scripts/check-bug-classes.mts --quiet     # No output if clean
 *   node scripts/check-bug-classes.mts --json      # Machine-readable
 *   node scripts/check-bug-classes.mts --explain   # Long-form output
 *
 * Allowlist lives at `.github/bug-class-allowlist.yml`. Each entry
 * requires a `reason` so the list stays audit-able and entries can be
 * removed when the underlying code changes.
 *
 * Why a class-based check instead of "just more tests":
 *   - Tests check behavior. These checks catch *shapes* that have
 *     historically caused behavior bugs. They're strictly cheaper than
 *     writing a test for every abort-the-isolate path.
 *   - LLM-based scans found these classes across 25 rounds. Codifying
 *     them turns one-time scan effort into permanent CI coverage.
 *   - Catches doc drift (skill docs referencing non-existent pnpm
 *     scripts) that escapes every other check.
 *
 * What it does NOT do:
 *   - Find NEW bug classes. R27+ quality scans still need to run
 *     periodically to discover shapes we haven't seen yet.
 *   - Understand semantics. A match that's obviously safe still
 *     requires an allowlist entry — this is the tradeoff for a
 *     dumb-but-fast regex gate.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MONOREPO_ROOT = path.join(__dirname, '..')
const ALLOWLIST_PATH = path.join(
  MONOREPO_ROOT,
  '.github',
  'bug-class-allowlist.yml',
)

type BugClass = {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  // Paths to scan. Relative to MONOREPO_ROOT.
  paths: string[]
  // Ripgrep pattern. Must include a capture so we can report the match.
  pattern: string
  // Ripgrep --glob filter (optional).
  glob?: string | undefined
  // Pass --multiline so the pattern can span newlines (for call-chain
  // shapes like `NewFromUtf8(...)\n  .ToLocalChecked()`).
  multiline?: boolean | undefined
  // One-paragraph explanation of WHY this shape is a bug.
  why: string
  // How to fix.
  fix: string
  // Rounds where this class caused a real bug — for context when the
  // check fails.
  precedents: string[]
}

const CLASSES: BugClass[] = [
  {
    id: 'cpp-tolocalchecked-on-bytes',
    title: 'ToLocalChecked() on non-literal UTF-8 input',
    severity: 'critical',
    paths: [
      'packages/node-smol-builder/additions/source-patched/src/socketsecurity',
    ],
    // Match `String::NewFromUtf8(isolate, <non-literal-first-arg>)`
    // followed (within the same expression tree) by `.ToLocalChecked(`.
    // The negative lookahead rejects string-literal first args (the
    // safe, fixed-ASCII case). `[^")]*` scans only non-quote,
    // non-close-paren content so we stay within the NewFromUtf8 call
    // and don't span into a later literal-arg call in the same block.
    //
    // Single-line pattern deliberately — cross-line NewFromUtf8 +
    // ToLocalChecked split across many statements is an actual
    // finding and we want it reported.
    pattern:
      String.raw`NewFromUtf8\(\s*isolate\s*,\s*(?!")[^"()]{0,200}?\)` +
      String.raw`\s*\.ToLocalChecked\(`,
    why:
      'V8 aborts the whole isolate when ToLocalChecked() is called on an ' +
      'empty MaybeLocal. NewFromUtf8 returns empty when the bytes fail UTF-8 ' +
      'validation, so calling this on network/file/DB/user-supplied bytes ' +
      'turns "bad input" into "process kill" — remote DoS if the caller is ' +
      'reachable from untrusted clients.',
    fix:
      'Use .ToLocal(&local) and fall back to an empty string, Null, or a ' +
      'fixed ASCII label on failure. See R14-R23 commits for the pattern.',
    precedents: ['R18', 'R19', 'R20', 'R21', 'R23'],
  },
  {
    id: 'cpp-tolocalchecked-on-v8-call',
    title:
      'ToLocalChecked() on V8 API call that can return empty MaybeLocal',
    severity: 'high',
    paths: [
      'packages/node-smol-builder/additions/source-patched/src/socketsecurity',
    ],
    // Match the common V8 APIs whose MaybeLocal return can be empty
    // (memory pressure, Proxy-trap exceptions, JSON parse failure,
    // template instantiation failure) and whose output reaches
    // ToLocalChecked on the same line or chained across one newline.
    // The original `cpp-tolocalchecked-on-bytes` rule only covered
    // `NewFromUtf8` — R31 surfaced abort sites on `NewInstance`,
    // `Get(context,...)`, and `Array::Get(context,i)` that the
    // narrow rule missed entirely.
    //
    // APIs flagged:
    //   *.NewInstance(context)
    //   *.Get(context, ...)
    //   *.Call(context, ...)
    //   *.CallAsFunction(context, ...)
    //   *.CallAsConstructor(context, ...)
    //   v8::JSON::Stringify(context, ...)
    //   v8::JSON::Parse(context, ...)
    //
    // Multiline mode so call chains like
    //   foo->NewInstance(context)
    //       .ToLocalChecked()
    // match. Negative lookbehind-esque gating: exclude NewFromUtf8
    // (its own rule handles that one) so we don't double-report.
    pattern:
      String.raw`\b(?:NewInstance|Get|Call|CallAsFunction|CallAsConstructor|JSON::Stringify|JSON::Parse)\(\s*context\s*[,)][\s\S]{0,200}?\.ToLocalChecked\(`,
    multiline: true,
    why:
      'V8 aborts the whole isolate when ToLocalChecked() is called on an ' +
      'empty MaybeLocal. NewInstance/Get/Call/JSON APIs all return empty ' +
      'on OOM, on exceptions thrown from Proxy traps or from the called ' +
      'function, and on JSON parse errors. A remote or JS-caller-supplied ' +
      'input can then kill the whole Node.js process — remote DoS if the ' +
      'API is reachable from untrusted clients.',
    fix:
      'Use ToLocal(&local) and handle the empty case with a JS exception, ' +
      'a fixed response (500 Internal Server Error for network-facing code), ' +
      'or an early return. See R31 uws_server.cc:263 and ffi/binding.cc:612 ' +
      'for the canonical fix patterns.',
    precedents: ['R31'],
  },
  {
    id: 'cpp-bare-new-at-entrypoint',
    title: 'Bare `new T()` at JS binding entry point (missing std::nothrow)',
    severity: 'high',
    paths: [
      'packages/node-smol-builder/additions/source-patched/src/socketsecurity',
    ],
    // Match `Type* var = new Type(` at indent 2 or 4, excluding the
    // nothrow form. Slow-but-correct Utf8Value-style shapes are caught
    // by the grep tool via ripgrep's multiline handling.
    pattern: String.raw`^\s{2,}\w[\w:]*\s*\*\s*\w+\s*=\s*new\s+[A-Z]\w`,
    why:
      'Node.js is compiled with -fno-exceptions, so std::bad_alloc turns ' +
      'into std::terminate() — a hard process kill, no recovery. Every ' +
      'new T() reachable from a JS binding must use std::nothrow + a null ' +
      'check, not bare new.',
    fix:
      'auto* obj = new (std::nothrow) T(...); if (!obj) { isolate->' +
      'ThrowException(v8::Exception::Error(...)); return; }',
    precedents: ['R15', 'R16', 'R17', 'R22'],
  },
  {
    id: 'ts-main-without-catch',
    title: 'Top-level async `main()` without `.catch()`',
    severity: 'high',
    paths: ['packages', 'scripts'],
    glob: '*.mts',
    // Multiline PCRE2 scan: match only when the file declares an
    // async main AND calls it at top level without a trailing
    // `.catch`. Sync `function main()` wrappers are exempt — they
    // set process.exitCode directly without a rejection channel, so
    // there is nothing to leak. The match reports the main() call
    // line via the final capture group.
    pattern:
      String.raw`(?s)async\s+function\s+main\b.*?^(main\(\)(?!\.catch))$`,
    multiline: true,
    why:
      'An async main() without .catch() leaks unhandled rejections as ' +
      'warnings instead of a clean exit 1 with error message. Breaks ' +
      'CI failure signaling and hides real errors in CLI tools.',
    fix:
      'main().catch((e: unknown) => { logger.error(errorMessage(e)); ' +
      'process.exitCode = 1 })',
    precedents: ['R17', 'R22'],
  },
  {
    id: 'ts-process-chdir',
    title: 'process.chdir() usage',
    severity: 'high',
    paths: ['packages', 'scripts'],
    glob: '*.{mts,ts,mjs,js}',
    pattern: String.raw`process\.chdir\(`,
    why:
      'process.chdir breaks tests, worker threads, and causes race ' +
      'conditions when multiple processes share the cwd. Forbidden ' +
      'per CLAUDE.md.',
    fix: 'Pass { cwd } options and absolute paths to spawn instead.',
    precedents: [],
  },
  {
    id: 'ts-bare-fetch',
    title: 'Bare `fetch()` usage',
    severity: 'medium',
    paths: ['packages', 'scripts'],
    glob: '*.{mts,ts}',
    pattern: String.raw`^\s*(?:await\s+)?fetch\(`,
    why:
      'Forbidden per CLAUDE.md — we wrap fetch with httpJson/httpText/' +
      'httpRequest from @socketsecurity/lib/http-request so calls go ' +
      'through the project-wide timeout, retry, and mock-registry ' +
      'machinery.',
    fix:
      "Use httpJson / httpText / httpRequest from " +
      "'@socketsecurity/lib/http-request' instead.",
    precedents: [],
  },
  {
    id: 'cpp-tmpfile-predictable',
    title: 'Predictable tmpfile name + fopen("w") (TOCTOU / symlink follow)',
    severity: 'high',
    paths: ['packages'],
    glob: '*.{c,cc,cpp,h,hpp}',
    // Match `fopen(<some_var_containing_tmp>, "w...")`. Hardcoded "/tmp/"
    // is a separate, louder shape caught by the next rule.
    pattern: String.raw`fopen\([^,]*(?:tmp|temp)[^,]*,\s*"w`,
    why:
      'Hardcoded or predictable tmp paths (e.g. /tmp/foo-<pid>) with ' +
      'fopen("wb") follow symlinks. On shared CI runners a local ' +
      'attacker can pre-create the path as a symlink to an arbitrary ' +
      'writable file, and our write overwrites it with attacker-chosen ' +
      'content.',
    fix:
      'Use mkstemp() (POSIX) — creates O_EXCL|0600 atomically, never ' +
      'follows symlinks. build-infra/file_io_common.h provides a ' +
      'mkstemp_portable helper for Windows.',
    precedents: ['R22', 'R25'],
  },
  {
    id: 'cpp-hardcoded-tmp-path',
    title: 'Hardcoded /tmp/ literal in a file path',
    severity: 'medium',
    paths: [
      'packages/node-smol-builder/additions/source-patched/src/socketsecurity',
    ],
    glob: '*.{c,cc,cpp,h,hpp}',
    pattern: String.raw`"/tmp/[a-zA-Z_]`,
    why:
      'Hardcoded /tmp/ paths assume a specific filesystem layout, are ' +
      'predictable across users, and bypass $TMPDIR / CI runner conventions.',
    fix:
      'Use get_tmpdir() (reads $TMPDIR / %TEMP% / falls back sensibly) ' +
      'combined with mkstemp_portable. See sea_inject.cc post-R22.',
    precedents: ['R22'],
  },
  {
    id: 'docs-pnpm-run-nonexistent',
    title: '`pnpm run <script>` references a non-existent script',
    severity: 'medium',
    paths: ['.claude/skills', 'docs'],
    glob: '*.md',
    // Captures the script name after `pnpm run `.
    pattern: String.raw`pnpm run ([a-zA-Z][a-zA-Z0-9:_-]*)`,
    // Intentional placeholder: this rule uses findNonExistentPnpmScripts
    // instead of a direct pattern match. Keeping the pattern here so the
    // class appears in the ledger; verifyCustom handles the resolution.
    why:
      'Skill docs that reference a pnpm script that no longer exists in ' +
      'the relevant package.json mislead humans and AI agents. Caught ' +
      'repeatedly in R22-R23 after script renames.',
    fix:
      'Update the doc to reference the actual script name, or add the ' +
      'script to the relevant package.json.',
    precedents: ['R22', 'R23'],
  },
  {
    id: 'cpp-size-overflow-bounds-check',
    title: '`a + b > c` bounds check with user-controlled operands',
    severity: 'high',
    paths: [
      'packages/node-smol-builder/additions/source-patched/src/socketsecurity',
    ],
    glob: '*.{c,cc,cpp,h,hpp}',
    // Catches `X + Y > Z` where X and Y end in _len/_size/offset/length.
    // Agent needs to verify context — this flags candidates, not failures.
    pattern:
      String.raw`(?:offset|[a-z_]+_len|[a-z_]+_size|[a-z_]+_length)\s*\+\s*` +
      String.raw`(?:[a-z_]+_len|[a-z_]+_size|[a-z_]+_length|\w+)\s*>`,
    why:
      'When both operands come from wire/user input, `a + b` can wrap ' +
      'before the comparison, silently passing the bounds check and ' +
      'producing an out-of-bounds read/write. R21 caught 5 sites in ' +
      'node_vfs.cc and R21/R24 caught the WebSocket variant.',
    fix:
      'Rewrite as `b > cap || a > cap - b` so the addition can never ' +
      'wrap. See http_binding.cc has_room helper for the canonical form.',
    precedents: ['R21', 'R24'],
  },
  {
    id: 'cpp-v8-fast-api-fallback',
    title: '`options.fallback` on v8::FastApiCallbackOptions (removed in V8 ≥ 12.x)',
    severity: 'high',
    paths: [
      'packages/node-smol-builder/additions/source-patched/src/socketsecurity',
    ],
    glob: '*.{c,cc,cpp,h,hpp}',
    // V8 12+ dropped the `fallback` field from FastApiCallbackOptions.
    // The remaining members are only `isolate` and `data`. Any code
    // still writing `options.fallback = ...` is a post-V8-upgrade
    // regression that stops the Node.js build with
    // `error: no member named 'fallback' in 'v8::FastApiCallbackOptions'`.
    pattern: String.raw`options\.fallback\s*=`,
    why:
      'The legacy pattern `options.fallback = true` is gone. Writing to ' +
      'that non-existent field is a compile error and blocks every ' +
      'subsequent Node.js upgrade. We have hit this recurrence cycle ' +
      'across multiple V8 bumps; codify it once.',
    fix:
      'Switch to the modern signal-via-exception idiom: ' +
      '`options.isolate->ThrowError("…"); return (placeholder);`. V8 ' +
      'observes the pending exception and replays the slow callback, ' +
      'so the placeholder value (0 / nullptr / void) never reaches JS.',
    precedents: [],
  },
  {
    id: 'pnpm-recursive-shadows-builtin',
    title: '`pnpm -r <name>` where <name> collides with a pnpm builtin',
    severity: 'medium',
    paths: ['package.json', 'packages', 'scripts', '.github/workflows'],
    glob: '*.{json,mts,ts,mjs,js,yml,yaml,sh}',
    // Match `pnpm -r <builtin>` or `pnpm --recursive <builtin>` for names
    // that ALSO exist as pnpm v11 builtin subcommands (clean, test, add,
    // remove, install, update, prune, pack, publish, audit). In those
    // cases pnpm parses the name as the builtin and REJECTS `-r` with
    // "Unknown option: 'recursive'". The unambiguous form is
    // `pnpm -r run <script>`.
    //
    // Args form (spawn call) uses comma-separated JS strings; shell form
    // uses spaces. Single pattern covers both via `[\s,]`.
    pattern:
      String.raw`pnpm['"]?[\s,]+(?:-r|--recursive)['"]?[\s,]+['"]?` +
      String.raw`(?:clean|test|add|remove|install|update|prune|pack|publish|audit|dedupe|fetch|import|outdated)\b`,
    why:
      'pnpm v11 promoted several workspace-script names to first-class ' +
      'builtins. `pnpm -r clean` stopped meaning "run the workspace ' +
      '`clean` script in every package" and started meaning "recursively ' +
      'invoke the builtin `pnpm clean`" — the builtin does not accept ' +
      '-r and fails with "Unknown option: recursive". Silent breakage ' +
      'in root package.json scripts and CI.',
    fix:
      'Use the unambiguous form `pnpm -r run <script>` (or ' +
      "`['--recursive', 'run', '<script>']` in spawn args) so pnpm " +
      'parses the name as a workspace script, not a builtin.',
    precedents: [],
  },
]

type AllowlistEntry = {
  file: string
  line?: number
  class: string
  reason: string
}

/**
 * Parse the allowlist YAML. Intentionally tiny parser — the file is
 * strictly shaped and we don't want to pull in a YAML dep just for this.
 */
function loadAllowlist(): AllowlistEntry[] {
  if (!existsSync(ALLOWLIST_PATH)) {
    return []
  }
  const content = readFileSync(ALLOWLIST_PATH, 'utf8')
  const entries: AllowlistEntry[] = []
  let current: Partial<AllowlistEntry> = {}
  let i = 0
  const lines = content.split(/\r?\n/)
  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed.startsWith('#') || trimmed === '' || trimmed === '---') {
      i += 1
      continue
    }
    if (line.startsWith('- ')) {
      if (current.file && current.class && current.reason) {
        entries.push(current as AllowlistEntry)
      }
      current = { __proto__: null } as Partial<AllowlistEntry>
      const firstKv = line.slice(2).match(/^(\w+):\s*(.+)$/)
      if (firstKv) {
        const [, key, rawValue] = firstKv
        const value = rawValue!.replace(/^['"]|['"]$/g, '')
        ;(current as Record<string, unknown>)[key!] =
          key === 'line' ? Number.parseInt(value, 10) : value
      }
    } else {
      const kv = trimmed.match(/^(\w+):\s*(.+)$/)
      if (kv) {
        const [, key, rawValue] = kv
        const value = rawValue!.replace(/^['"]|['"]$/g, '')
        ;(current as Record<string, unknown>)[key!] =
          key === 'line' ? Number.parseInt(value, 10) : value
      }
    }
    i += 1
  }
  if (current.file && current.class && current.reason) {
    entries.push(current as AllowlistEntry)
  }
  return entries
}

type Match = {
  file: string
  line: number
  column: number
  text: string
  bugClass: BugClass
}

async function runRipgrep(bugClass: BugClass): Promise<Match[]> {
  const matches: Match[] = []
  for (const scanPath of bugClass.paths) {
    const absPath = path.join(MONOREPO_ROOT, scanPath)
    if (!existsSync(absPath)) {
      continue
    }
    const args = [
      '--vimgrep',
      '--no-config',
      '--pcre2',
    ]
    if (bugClass.multiline) {
      // ripgrep needs --multiline AND --multiline-dotall for [\s\S]
      // to match newlines reliably across patterns. Without dotall
      // `.` still stops at \n even in multiline mode.
      args.push('--multiline', '--multiline-dotall')
    }
    args.push('-e', bugClass.pattern)
    if (bugClass.glob) {
      args.push('-g', bugClass.glob)
    }
    // Exclude upstream / build / node_modules / source-patched
    // mirrors, and this script itself (its description strings contain
    // pattern-like text that would self-match).
    args.push(
      '-g',
      '!**/upstream/**',
      '-g',
      '!**/build/**',
      '-g',
      '!**/node_modules/**',
      '-g',
      '!**/dist/**',
      '-g',
      '!**/out/**',
      '-g',
      '!**/source-patched/src/socketsecurity/{bin-infra,binject,build-infra}/**',
      '-g',
      '!scripts/check-bug-classes.mts',
    )
    args.push(absPath)
    // ripgrep exits 1 when there are no matches (not an error for us),
    // 2+ when something actually went wrong. Capture stdout regardless
    // and treat only genuine errors as failures. `error` is `unknown`
    // from catch, so narrow it defensively — no `as { code }` casts.
    let stdout = ''
    try {
      const result = await spawn('rg', args, {
        cwd: MONOREPO_ROOT,
        stdio: 'pipe',
      })
      stdout = String(result.stdout || '')
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code?: unknown }).code
          : undefined
      const errStdout =
        typeof e === 'object' && e !== null && 'stdout' in e
          ? (e as { stdout?: unknown }).stdout
          : undefined
      if (code === 1 || code === '1') {
        // "no matches" — fine
        stdout = errStdout == null ? '' : String(errStdout)
      } else {
        throw e
      }
    }
    for (const rawLine of stdout.split('\n')) {
      if (!rawLine) {
        continue
      }
      // vimgrep format: file:line:col:text. The file path can contain ':'
      // (Windows drive letters, filenames like `2026-04-24:report.txt`,
      // colon-prefixed submodule refs) so splitting on bare ':' is wrong and
      // so is non-greedy `.+?:\d+` anchoring — that matches the FIRST `:<digit>`
      // pair, misattributing `foo:1:2:bar.ts:12:5:match` to `file="foo"`.
      // Use greedy `.+` so the regex engine backtracks to leave exactly
      // `:<line>:<col>:<text>` at the end — the last three colons are the
      // authoritative separators.
      const match = rawLine.match(/^(.+):(\d+):(\d+):(.*)$/)
      if (!match) {
        continue
      }
      const file = match[1]!
      const line = Number.parseInt(match[2]!, 10)
      const column = Number.parseInt(match[3]!, 10)
      const text = match[4]!.trim()
      // Skip pure comment lines — these describe the bug class, they
      // aren't instances of it. Handles C/C++ (`//`, `*`), markdown
      // (`>`), and TS JSDoc (`*`) line comments. Block comments
      // beginning with `/*` on the match line are also skipped.
      if (
        /^(?:\/\/|\*|\/\*|>)/.test(text) ||
        /^\s*\*\s/.test(text)
      ) {
        continue
      }
      matches.push({
        file: path.relative(MONOREPO_ROOT, file),
        line,
        column,
        text,
        bugClass,
      })
    }
  }
  return matches
}

/**
 * Resolve every `pnpm run <script>` reference in skill/docs markdown
 * against the actual package.json script registry. Returns markdown
 * references whose target script does NOT exist in any package.json
 * within this monorepo.
 */
async function findNonExistentPnpmScripts(
  bugClass: BugClass,
): Promise<Match[]> {
  const matches: Match[] = []
  // Gather all known pnpm scripts across the monorepo.
  const knownScripts = new Set<string>()
  const collectPackageScripts = async (pkgJsonPath: string) => {
    if (!existsSync(pkgJsonPath)) {
      return
    }
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
      const scripts = pkg.scripts || {}
      for (const name of Object.keys(scripts)) {
        knownScripts.add(name)
      }
    } catch {
      // ignore parse errors
    }
  }
  await collectPackageScripts(path.join(MONOREPO_ROOT, 'package.json'))
  const pkgsDir = path.join(MONOREPO_ROOT, 'packages')
  if (existsSync(pkgsDir)) {
    const entries = await (
      await import('node:fs')
    ).promises.readdir(pkgsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await collectPackageScripts(
          path.join(pkgsDir, entry.name, 'package.json'),
        )
      }
    }
  }

  // Grep markdown files for `pnpm run <script>`.
  const rawMatches = await runRipgrep(bugClass)
  // Allowlist of documentation placeholders that are not real scripts.
  // These are explicit examples in skill docs explaining the convention.
  const placeholders = new Set(['foo', 'bar', 'baz', 'script'])
  for (const m of rawMatches) {
    // Extract the script name from the captured line text.
    const runMatch = m.text.match(/pnpm run ([a-zA-Z][a-zA-Z0-9:_-]*)/)
    if (!runMatch) {
      continue
    }
    const scriptName = runMatch[1]!
    if (placeholders.has(scriptName)) {
      continue
    }
    if (!knownScripts.has(scriptName)) {
      matches.push({ ...m, text: `pnpm run ${scriptName} (not in any package.json)` })
    }
  }
  return matches
}

type Options = {
  explain: boolean
  json: boolean
  quiet: boolean
}

function printMatch(m: Match, opts: Options): void {
  const { bugClass } = m
  if (opts.json) {
    logger.log(
      JSON.stringify({
        class: bugClass.id,
        column: m.column,
        file: m.file,
        line: m.line,
        severity: bugClass.severity,
        text: m.text,
        title: bugClass.title,
      }),
    )
    return
  }
  const locator = `${m.file}:${m.line}:${m.column}`
  const sev = bugClass.severity.toUpperCase()
  logger.log('')
  logger.log(`[${sev}] ${bugClass.title}`)
  logger.log(`  ${locator}`)
  logger.log(`    ${m.text}`)
  if (opts.explain) {
    logger.log('')
    logger.log(`  Why it matters:`)
    for (const chunk of wrapText(bugClass.why, 74, 4)) {
      logger.log(chunk)
    }
    logger.log('')
    logger.log(`  Fix:`)
    for (const chunk of wrapText(bugClass.fix, 74, 4)) {
      logger.log(chunk)
    }
    if (bugClass.precedents.length > 0) {
      logger.log('')
      logger.log(
        `  This shape was shipped as a real bug in: ${bugClass.precedents.join(', ')}`,
      )
    }
  } else {
    logger.log(`  → rerun with --explain for why + fix`)
    logger.log(`  → or allowlist in .github/bug-class-allowlist.yml`)
  }
}

function wrapText(text: string, width: number, indent: number): string[] {
  const out: string[] = []
  const pad = ' '.repeat(indent)
  const words = text.split(/\s+/)
  let line = ''
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      out.push(pad + line)
      line = w
    } else {
      line = line ? `${line} ${w}` : w
    }
  }
  if (line) {
    out.push(pad + line)
  }
  return out
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      explain: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    strict: false,
  })
  const opts: Options = {
    explain: Boolean(values.explain),
    json: Boolean(values.json),
    quiet: Boolean(values.quiet),
  }

  const allowlist = loadAllowlist()
  const allowSet = new Set(
    allowlist.map(e =>
      e.line !== undefined ? `${e.file}:${e.line}:${e.class}` : `${e.file}:${e.class}`,
    ),
  )

  if (!opts.quiet && !opts.json) {
    logger.info('Scanning for known bug-class regressions...')
  }

  const allMatches: Match[] = []
  for (const bugClass of CLASSES) {
    let matches: Match[]
    if (bugClass.id === 'docs-pnpm-run-nonexistent') {
      matches = await findNonExistentPnpmScripts(bugClass)
    } else {
      matches = await runRipgrep(bugClass)
    }
    for (const m of matches) {
      const lineKey = `${m.file}:${m.line}:${bugClass.id}`
      const fileKey = `${m.file}:${bugClass.id}`
      if (allowSet.has(lineKey) || allowSet.has(fileKey)) {
        continue
      }
      allMatches.push(m)
    }
  }

  if (allMatches.length === 0) {
    if (!opts.quiet && !opts.json) {
      logger.success(
        `No bug-class regressions found (${CLASSES.length} classes × ${allowlist.length} allowlisted)`,
      )
    }
    process.exitCode = 0
    return
  }

  // Group by class for a readable summary first.
  const byClass = new Map<string, Match[]>()
  for (const m of allMatches) {
    const key = m.bugClass.id
    const arr = byClass.get(key) || []
    arr.push(m)
    byClass.set(key, arr)
  }

  if (opts.json) {
    for (const m of allMatches) {
      printMatch(m, opts)
    }
  } else {
    logger.error(
      `Found ${allMatches.length} bug-class regression${allMatches.length === 1 ? '' : 's'} across ${byClass.size} class${byClass.size === 1 ? '' : 'es'}:`,
    )
    for (const m of allMatches) {
      printMatch(m, opts)
    }
    logger.log('')
    logger.log('What to do:')
    logger.log('  1. If it is a real bug: fix it (see --explain for the pattern).')
    logger.log('  2. If the match is safe: add to .github/bug-class-allowlist.yml')
    logger.log('     with file, line, class, and a reason. Each entry is audit-')
    logger.log('     able so future readers know why the check was bypassed.')
    logger.log('  3. Run with --explain for the full why + fix writeup.')
  }

  process.exitCode = 1
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})

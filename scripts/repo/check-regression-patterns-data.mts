/**
 * @file Data table for `check-regression-patterns.mts`: the known
 *   ripgrep-detectable regression shapes (id, severity, scan paths, pattern,
 *   why, fix, precedents). Split out of the checker script so the
 *   orchestration file (arg parsing, ripgrep invocation, report printing)
 *   stays under the file-size soft cap.
 */

export type Regression = {
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
  // Rounds where this shape caused a real bug — for context when the
  // check fails.
  precedents: string[]
}

export const REGRESSIONS: Regression[] = [
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
    title: 'ToLocalChecked() on V8 API call that can return empty MaybeLocal',
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
    pattern: String.raw`\b(?:NewInstance|Get|Call|CallAsFunction|CallAsConstructor|JSON::Stringify|JSON::Parse)\(\s*context\s*[,)][\s\S]{0,200}?\.ToLocalChecked\(`,
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
    pattern: String.raw`(?s)async\s+function\s+main\b.*?^(main\(\)(?!\.catch))$`,
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
      'httpRequest from @socketsecurity/lib-stable/http-request so calls go ' +
      'through the project-wide timeout, retry, and mock-registry ' +
      'machinery.',
    fix:
      'Use httpJson / httpText / httpRequest from ' +
      "'@socketsecurity/lib-stable/http-request' instead.",
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
    title:
      '`options.fallback` on v8::FastApiCallbackOptions (removed in V8 ≥ 12.x)',
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

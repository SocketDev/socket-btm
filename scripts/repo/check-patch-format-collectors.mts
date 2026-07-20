/**
 * @file Collectors for `check-patch-format.mts`: patch parsing + the
 *   per-directory/per-file structural checks (multiple patches touching one
 *   source file, gaps in the numbered-prefix series, and the full unified
 *   diff format validation). Split out of the checker script so the
 *   orchestration file (arg parsing, allowlist, report printing) stays under
 *   the file-size soft cap.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { naturalCompare } from '@socketsecurity/lib-stable/sorts/natural'

import { errorMessage } from 'build-infra/lib/error-utils'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const MONOREPO_ROOT = path.join(__dirname, '..')

export type Violation = {
  file: string
  line: number
  rule: string
  detail: string
  // Optional fix hint specific to this violation instance.
  fix?: string | undefined
}

// Check that no source file is modified by more than one patch in the
// same directory. CLAUDE.md "Patch Rules" requires "1 patch, 1 file" —
// not just within a patch, but across the whole series. Two patches
// touching `src/node_binding.cc` is a convention violation; fold them
// into one patch instead.
export function collectMultiplePatchesPerFileViolations(
  dir: string,
): Violation[] {
  if (!existsSync(dir)) {
    return []
  }
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.patch'))
    .toSorted(naturalCompare)
  // Map from touched-source-file path → list of patch filenames that
  // modify it. We read each patch, parse its `--- a/<file>` markers,
  // and accumulate.
  const fileToPatches = new Map<string, string[]>()
  for (
    let fileIndex = 0, { length: fileCount } = files;
    fileIndex < fileCount;
    fileIndex += 1
  ) {
    const patchName = files[fileIndex]!
    const abs = path.join(dir, patchName)
    let content
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    // Parse the patch's `--- a/<path>` markers. Mirror the parsing
    // shape from validatePatch's own use to stay consistent.
    const minusFiles = new Set<string>()
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const line of content.split('\n')) {
      const match = /^---\s+a\/(.+?)\s*$/.exec(line)
      if (match) {
        minusFiles.add(match[1]!)
      }
    }
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is a Set (not array-indexed)
    for (const f of minusFiles) {
      const list = fileToPatches.get(f) ?? []
      list.push(patchName)
      fileToPatches.set(f, list)
    }
  }
  const violations: Violation[] = []
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [sourceFile, patches] of fileToPatches) {
    if (patches.length <= 1) {
      continue
    }
    // Report the violation against the second + later patches (the
    // first one to touch a file is the canonical owner; subsequent
    // ones are the violators). This makes the fix path clear: fold
    // the violator's hunks into the canonical patch.
    const canonical = patches[0]!
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const violator of patches.slice(1)) {
      violations.push({
        detail:
          `Patch ${violator} modifies ${sourceFile}, which is already ` +
          `owned by ${canonical}. CLAUDE.md "Patch Rules" requires ` +
          `1 patch per source file across the entire series.`,
        file: path.relative(MONOREPO_ROOT, path.join(dir, violator)),
        fix:
          `Fold this patch's hunks into ${canonical} and remove this ` +
          `now-redundant patch file. If the split is intentional and ` +
          `documented, allowlist with \`rule: multiple-patches-per-file\`.`,
        line: 1,
        rule: 'multiple-patches-per-file',
      })
    }
  }
  return violations
}

/**
 * Extract the filename-numeric-prefix (e.g. "001" from "001-foo.patch").
 */
export function numericPrefix(file: string): number | undefined {
  const match = path.basename(file).match(/^(\d+)-/)
  return match ? Number.parseInt(match[1]!, 10) : undefined
}

export function collectNumberGapViolations(dir: string): Violation[] {
  if (!existsSync(dir)) {
    return []
  }
  const files = readdirSync(dir).filter(f => f.endsWith('.patch'))
  const numbered: Array<{ name: string; num: number }> = []
  for (
    let fileIndex = 0, { length: fileCount } = files;
    fileIndex < fileCount;
    fileIndex += 1
  ) {
    const name = files[fileIndex]!
    const num = numericPrefix(name)
    if (num !== undefined) {
      numbered.push({ name, num })
    }
  }
  if (numbered.length === 0) {
    return []
  }
  numbered.sort((a, b) => a.num - b.num)
  const violations: Violation[] = []
  for (let i = 1; i < numbered.length; i += 1) {
    const prev = numbered[i - 1]!
    const curr = numbered[i]!
    if (curr.num !== prev.num + 1) {
      const gap = curr.num - prev.num - 1
      violations.push({
        detail:
          `Gap of ${gap} in numbered series: ${prev.name} -> ${curr.name}. ` +
          `Either renumber the series to close the gap, or add an ` +
          `allowlist entry with \`rule: numbered-series-gap\` if the ` +
          `gap is intentional.`,
        file: path.relative(MONOREPO_ROOT, path.join(dir, curr.name)),
        fix: `Rename ${curr.name} and following files down by ${gap}, or allowlist as intentional.`,
        line: 1,
        rule: 'numbered-series-gap',
      })
    }
  }
  return violations
}

export type Hunk = {
  // 1-indexed line inside the patch where the `@@ -A,B +C,D @@` header sits
  headerLine: number
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  // Actual body lines (excluding the header line itself). Indexed in order.
  body: string[]
  // Line number within the patch where the body starts
  bodyStartLine: number
}

export type ParsedPatch = {
  headerLines: string[] // The leading `# ...` / blank lines before the diff
  minusFiles: string[] // From `--- a/...`
  plusFiles: string[] // From `+++ b/...`
  hunks: Hunk[]
}

/**
 * Parse a unified-diff patch into structured form. This intentionally
 * doesn't invoke `git apply --check` or `patch --dry-run` — we want to
 * validate format integrity independently of whether the patched tree
 * is currently checked out.
 */
export function parsePatch(content: string): ParsedPatch {
  const lines = content.split(/\r?\n/)
  const headerLines: string[] = []
  const minusFiles: string[] = []
  const plusFiles: string[] = []
  const hunks: Hunk[] = []
  let i = 0
  // Collect header comment lines until we hit the first diff marker.
  while (i < lines.length) {
    const line = lines[i]!
    if (
      line.startsWith('--- ') ||
      line.startsWith('diff --git ') ||
      line.startsWith('Index: ') ||
      line.startsWith('From ')
    ) {
      break
    }
    headerLines.push(line)
    i += 1
  }
  // Walk diff sections. Each section begins with `--- a/...` / `+++ b/...`
  // then one or more `@@ ... @@` hunks.
  while (i < lines.length) {
    const line = lines[i]!
    if (line.startsWith('--- ')) {
      minusFiles.push(line.slice(4).split(/\s/)[0] || '')
      i += 1
      continue
    }
    if (line.startsWith('+++ ')) {
      plusFiles.push(line.slice(4).split(/\s/)[0] || '')
      i += 1
      continue
    }
    // Matches a unified-diff hunk header `@@ -A,B +C,D @@`: old start
    // line (group 1), optional old line count (group 2), new start
    // line (group 3), optional new line count (group 4).
    const hunkHeaderMatch = line.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
    )
    if (hunkHeaderMatch) {
      const hunk: Hunk = {
        body: [],
        bodyStartLine: i + 2, // 1-indexed, line after header
        headerLine: i + 1,
        newCount:
          hunkHeaderMatch[4] === undefined
            ? 1
            : Number.parseInt(hunkHeaderMatch[4], 10),
        newStart: Number.parseInt(hunkHeaderMatch[3]!, 10),
        oldCount:
          hunkHeaderMatch[2] === undefined
            ? 1
            : Number.parseInt(hunkHeaderMatch[2], 10),
        oldStart: Number.parseInt(hunkHeaderMatch[1]!, 10),
      }
      i += 1
      // Consume body lines until the next diff marker, hunk header, or EOF.
      while (i < lines.length) {
        const bodyLine = lines[i]!
        if (
          bodyLine.startsWith('--- ') ||
          bodyLine.startsWith('+++ ') ||
          /^@@ -\d+/.test(bodyLine) ||
          bodyLine.startsWith('diff --git ')
        ) {
          break
        }
        hunk.body.push(bodyLine)
        i += 1
      }
      hunks.push(hunk)
      continue
    }
    // Unknown line between diff sections — tolerate.
    i += 1
  }
  return { headerLines, hunks, minusFiles, plusFiles }
}

export function validatePatch(absPath: string, project: string): Violation[] {
  const relPath = path.relative(MONOREPO_ROOT, absPath)
  const violations: Violation[] = []
  let content: string
  try {
    content = readFileSync(absPath, 'utf8')
  } catch (e) {
    violations.push({
      detail: `Failed to read: ${errorMessage(e)}`,
      file: relPath,
      line: 0,
      rule: 'readable',
    })
    return violations
  }

  // Rule: no `git format-patch` preamble. Those start with `From <sha>`
  // and include `Subject:`/`Date:` — caught by either marker.
  if (/^From [0-9a-f]{7,40}\s/.test(content) || /^Subject:/m.test(content)) {
    violations.push({
      detail:
        'File starts with `git format-patch` preamble (From/Subject). ' +
        'Convert to a standard unified diff (`diff -u a/file b/file`) ' +
        'with `# @<project>-versions:` + `# @description:` headers.',
      file: relPath,
      fix: 'Rewrite using unified diff format (see CLAUDE.md "Source Patches" → Format).',
      line: 1,
      rule: 'no-git-format-patch',
    })
    // Don't continue validating — the rest of the rules assume unified diff.
    return violations
  }

  const parsed = parsePatch(content)

  // Rule: first non-blank header line must be `# @<project>-versions: v...`.
  const firstContent = parsed.headerLines.find(l => l.trim() !== '')
  const expectedTag = `# @${project}-versions:`
  if (!firstContent || !firstContent.startsWith(expectedTag)) {
    violations.push({
      detail: `Missing or misplaced \`${expectedTag} vX.Y.Z\` header on the first non-blank line. Got: ${firstContent ? JSON.stringify(firstContent) : '(empty)'}`,
      file: relPath,
      fix: `Add \`${expectedTag} vX.Y.Z\` as the very first line of the patch.`,
      line: 1,
      rule: 'version-header',
    })
  } else {
    // Matches the `# @<project>-versions: vX.Y[.Z]` header and captures
    // the version number (optional leading `v`, optional patch component).
    const versionMatch = firstContent.match(
      /^# @[a-z-]+-versions:\s+v?(\d+\.\d+(?:\.\d+)?)/,
    )
    if (!versionMatch) {
      violations.push({
        detail: `\`${expectedTag}\` present but version string is missing or malformed in: ${JSON.stringify(firstContent)}`,
        file: relPath,
        fix: 'Use semver format `vMAJOR.MINOR[.PATCH]` (e.g. `v25.9.0`).',
        line: 1,
        rule: 'version-header',
      })
    }
  }

  // Rule: a `# @description:` header must appear before the diff.
  const descLine = parsed.headerLines.findIndex(l =>
    /^#\s*@description:/.test(l),
  )
  if (descLine === -1) {
    violations.push({
      detail:
        'Missing `# @description: <one-line summary>` header. Every patch needs a human-readable description next to its version tag.',
      file: relPath,
      fix: 'Add `# @description: <what this patch does>` below the version header.',
      line: 1,
      rule: 'description-header',
    })
  } else {
    const descText = parsed.headerLines[descLine]!.replace(
      /^#\s*@description:\s*/,
      '',
    ).trim()
    if (descText === '') {
      violations.push({
        detail: '`# @description:` header is present but empty.',
        file: relPath,
        fix: 'Fill in a one-line description of what the patch changes.',
        line: descLine + 1,
        rule: 'description-header',
      })
    }
  }

  // Rule: patch must touch exactly one file (per CLAUDE.md Patch Rules).
  const uniqueFiles = Array.from(
    new Set(parsed.minusFiles.concat(parsed.plusFiles)),
  )
  if (parsed.minusFiles.length === 0) {
    violations.push({
      detail: 'No `--- a/<file>` diff section found.',
      file: relPath,
      fix: 'Add a unified-diff section with `--- a/path` / `+++ b/path` markers.',
      line: 1,
      rule: 'has-diff',
    })
  } else {
    // Pair up minus/plus: there must be one plus per minus with matching path.
    if (parsed.minusFiles.length !== parsed.plusFiles.length) {
      violations.push({
        detail: `Mismatched \`--- a/\` (${parsed.minusFiles.length}) and \`+++ b/\` (${parsed.plusFiles.length}) markers.`,
        file: relPath,
        fix: 'Ensure every `--- a/<file>` is followed by a matching `+++ b/<file>`.',
        line: 1,
        rule: 'diff-pairs',
      })
    }
    // "One file per patch" — the minus and plus sides may reference the same
    // file (rename yields a and b being different); what matters is only one
    // *a-side* and one *b-side* path.
    const distinctMinus = new Set(parsed.minusFiles)
    const distinctPlus = new Set(parsed.plusFiles)
    if (distinctMinus.size > 1 || distinctPlus.size > 1) {
      violations.push({
        detail: `Patch touches ${uniqueFiles.length} files — CLAUDE.md "Patch Rules" requires one file per patch. Files: ${uniqueFiles.join(', ')}`,
        file: relPath,
        fix: 'Split this patch into per-file entries using the numbered-prefix series (001-, 002-, ...).',
        line: 1,
        rule: 'one-file-per-patch',
      })
    }
  }

  // Rule: hunk line counts match header numbers.
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const hunk of parsed.hunks) {
    let contextLines = 0
    let minusLines = 0
    let plusLines = 0
    // Diff line-count semantics:
    //   ' ' prefix  → context line
    //   '-' prefix  → removed line
    //   '+' prefix  → added line
    //   '\' prefix  → "No newline at end of file" (doesn't count)
    //   empty line  → ambiguous: either a trailing-newline artifact
    //                 from our split(), or a bare-blank context line
    //                 (the strict spec wants ` ` + blank, but many
    //                 patches in the wild and tools like `git apply`
    //                 tolerate a truly empty line as context).
    //
    // Heuristic: the last empty token in the hunk body is almost
    // always the file-terminator artifact from split(). Empty tokens
    // at any other position are treated as bare-blank context — this
    // matches how git/patch actually parse these files and avoids
    // spurious count mismatches on real-world patches (R19-R21).
    const lastContentIndex = (() => {
      for (let j = hunk.body.length - 1; j >= 0; j -= 1) {
        if (hunk.body[j] !== '') {
          return j
        }
      }
      return -1
    })()
    for (let bi = 0; bi < hunk.body.length; bi += 1) {
      const bodyLine = hunk.body[bi]!
      if (bodyLine === '') {
        if (bi > lastContentIndex) {
          // Trailing split() artifact — skip.
          continue
        }
        // Blank line between content lines — treat as context (matches
        // git/patch tolerance for bare-newline context) for count
        // purposes, but ALSO flag it as a style violation. The strict
        // unified-diff spec requires every context line to begin with
        // a single space, even if the source line is blank. Some tools
        // (`filterdiff`, some minimal patch implementations) truncate
        // a hunk at the first bare-newline line. Surfacing this as a
        // warning-grade finding lets us keep the tolerant count logic
        // (so existing patches still validate on hunk counts) while
        // pushing new patches toward strict compliance.
        contextLines += 1
        violations.push({
          detail:
            `Bare empty line (no ' ' prefix) inside hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@. ` +
            'Strict unified diff requires every context line to begin with a single space, even when blank.',
          file: relPath,
          fix: "Replace the bare newline with ' \\n' (single space + newline). Most editors strip trailing whitespace — use `printf ' \\n'` or `awk` to rewrite.",
          line: hunk.bodyStartLine + bi,
          rule: 'bare-empty-context-line',
        })
        continue
      }
      if (bodyLine.startsWith(' ')) {
        contextLines += 1
      } else if (bodyLine.startsWith('-')) {
        minusLines += 1
      } else if (bodyLine.startsWith('+')) {
        plusLines += 1
      } else if (bodyLine.startsWith('\\')) {
        // "\ No newline at end of file" — doesn't contribute to counts.
        continue
      }
    }
    const oldActual = contextLines + minusLines
    const newActual = contextLines + plusLines
    if (oldActual !== hunk.oldCount) {
      violations.push({
        detail:
          `Hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ ` +
          `claims ${hunk.oldCount} old lines but body has ${oldActual} ` +
          `(${contextLines} context + ${minusLines} minus).`,
        file: relPath,
        fix: `Correct the old-line count: change \`@@ -${hunk.oldStart},${hunk.oldCount}\` to \`@@ -${hunk.oldStart},${oldActual}\`.`,
        line: hunk.headerLine,
        rule: 'hunk-old-count',
      })
    }
    if (newActual !== hunk.newCount) {
      violations.push({
        detail:
          `Hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ ` +
          `claims ${hunk.newCount} new lines but body has ${newActual} ` +
          `(${contextLines} context + ${plusLines} plus).`,
        file: relPath,
        fix: `Correct the new-line count: change \`+${hunk.newStart},${hunk.newCount}\` to \`+${hunk.newStart},${newActual}\`.`,
        line: hunk.headerLine,
        rule: 'hunk-new-count',
      })
    }
  }
  return violations
}

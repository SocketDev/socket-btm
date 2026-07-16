/**
 * @file Generates src/wrapper/YGEnums.mts from the checked-out yoga C++ header
 *   (yoga/YGEnums.h). Both the header and the embind.cpp that the WASM binary
 *   compiles from live in the SAME pinned submodule, so the generated enum
 *   values can never drift from the binary's ABI — a yoga bump moves the
 *   submodule and regenerates the enums from the new header in one step.
 *   Replaces the hand-ported mirror that previously had to be re-synced by
 *   hand on every yoga bump (and which a lint autofix once corrupted).
 *   Parsing target — the `YG_ENUM_DECL` macro form in YGEnums.h:
 *   YG_ENUM_DECL(
 *   YGAlign,
 *   YGAlignAuto,            // → Align.Auto = 0
 *   YGAlignFlexStart,       // → Align.FlexStart = 1
 *   ...)
 *   YG_ENUM_DECL(
 *   YGErrata,
 *   YGErrataNone = 0,       // explicit values honored (bitmask enum)
 *   YGErrataStretchFlexBasis = 1,
 *   YGErrataAll = 2147483647, ...)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

interface EnumMember {
  name: string
  value: number
}

interface ParsedEnum {
  name: string
  members: EnumMember[]
}

// Matches the version token in wrapAssembly.mts's Lock-step line so the build
// can re-stamp it from the verified submodule version (never hand-edited).
const WRAP_ASSEMBLY_VERSION_RE =
  /(Lock-step from upstream: yoga\/javascript\/src\/wrapAssembly\.ts @ yoga )(\S+)/

/**
 * Read the yoga enum header, generate the module, and write it to the wrapper
 * path. Returns the generated text (for the build's smoke test to diff).
 */
export async function generateEnumsFile(
  enumHeaderPath: string,
  outputPath: string,
  yogaVersion: string,
): Promise<string> {
  const header = await fs.readFile(enumHeaderPath, 'utf8')
  const enums = parseEnumHeader(header)
  if (enums.length === 0) {
    throw new Error(
      `parseEnumHeader found 0 YG_ENUM_DECL blocks in ${enumHeaderPath} — ` +
        'the header format changed; update generate-enums.mts.',
    )
  }
  const rendered = renderEnumsModule(enums, yogaVersion)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, rendered, 'utf8')
  return rendered
}

/**
 * Parse every `YG_ENUM_DECL(...)` block out of YGEnums.h. Returns the JS-facing
 * enum name (YG-prefix stripped) and members (enum-prefix stripped), with
 * sequential values from 0 unless an explicit `= N` is present, after which
 * the running counter continues from that value.
 */
export function parseEnumHeader(header: string): ParsedEnum[] {
  const enums: ParsedEnum[] = []
  // Match YG_ENUM_DECL( ... ) — capture the parenthesized body (non-greedy to
  // the first closing paren, which is safe because the macro never nests parens).
  const declRe = /YG_ENUM_DECL\(\s*([\s\S]*?)\)/g
  let m: RegExpExecArray | null
  while ((m = declRe.exec(header)) !== null) {
    const body = m[1]!
    // Split on commas, trim, drop comments + empties.
    const tokens = body
      .split(',')
      .map(t => t.replace(/\/\/.*$/gm, '').trim())
      .filter(Boolean)
    if (tokens.length < 2) {
      continue
    }
    const rawEnumName = tokens[0]! // e.g. YGAlign
    const enumName = rawEnumName.replace(/^YG/, '') // Align
    const members: EnumMember[] = []
    let nextValue = 0
    for (let i = 1; i < tokens.length; i += 1) {
      const tok = tokens[i]!
      // tok is either `YGAlignAuto`, `YGErrataNone = 0`, `YGFlagThing = 0x1`,
      // or a negative decimal. Accept hex literals so bitmask enums upstream
      // can adopt the conventional `0x…` form without silently falling
      // through to the auto-increment counter.
      const eqMatch = tok.match(/^(\S+)\s*=\s*(-?(?:0[xX][0-9a-fA-F]+|\d+))$/)
      const rawMember = eqMatch ? eqMatch[1]! : tok
      // Strip the full enum prefix: YGAlignAuto → Auto.
      const memberName = rawMember.replace(new RegExp(`^${rawEnumName}`), '')
      const value = eqMatch ? Number(eqMatch[2]) : nextValue
      if (!Number.isFinite(value)) {
        throw new Error(
          `generate-enums: failed to parse value for ${rawEnumName}.${memberName} (token: ${tok})`,
        )
      }
      // Guard the auto-increment counter against silent 32-bit overflow.
      // The WASM-emitted enum is i32, so a JS Number > 2^31-1 here would
      // ABI-drift from the runtime value.
      if (!eqMatch && nextValue > 0x7f_ff_ff_ff) {
        throw new Error(
          `generate-enums: ${rawEnumName}.${memberName} would auto-increment past int32 (${nextValue}); pin an explicit value upstream`,
        )
      }
      members.push({ name: memberName, value })
      nextValue = value + 1
    }
    enums.push({ name: enumName, members })
  }
  return enums
}

/**
 * Render the parsed enums to the YGEnums.mts source text: one `export const`
 * per enum, the flat `constants` SCREAMING_SNAKE table the yoga-layout npm API
 * exposes, then `export { constants }` + `export default constants` (the
 * wrapAssembly inliner consumes the default as `YGEnums`).
 *
 * `yogaVersion` is the build-verified version of the checked-out submodule; it
 * is stamped into the header so the file self-documents which yoga it mirrors
 * without anyone hand-editing a version comment.
 */
export function renderEnumsModule(
  enums: ParsedEnum[],
  yogaVersion: string,
): string {
  const lines: string[] = []
  lines.push('/**')
  lines.push(' * Yoga Layout Enums.')
  lines.push(' *')
  lines.push(
    ` * GENERATED from upstream yoga/YGEnums.h @ yoga ${yogaVersion} by`,
  )
  lines.push(
    ' * scripts/source-cloned/shared/generate-enums.mts — do not edit by hand.',
  )
  lines.push(
    ' * Copyright (c) Meta Platforms, Inc. and affiliates. MIT License.',
  )
  lines.push(' */')
  lines.push('')

  for (let i = 0, { length } = enums; i < length; i += 1) {
    const e = enums[i]!
    // Emit members ASCII-sorted so generator output already satisfies the
    // fleet sort lint — otherwise `pnpm run fix` re-sorts the file and the
    // next regen flips it back. Safe: every member carries an explicit value.
    const sorted = [...e.members].toSorted((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    lines.push(`export const ${e.name} = {`)
    for (let j = 0, mlen = sorted.length; j < mlen; j += 1) {
      const mem = sorted[j]!
      lines.push(`  ${mem.name}: ${mem.value},`)
    }
    lines.push('}')
    lines.push('')
  }

  lines.push(
    '// Flat constant exports for compatibility with yoga-layout npm package API.',
  )
  lines.push('const constants = {')
  const constantEntries: Array<{ key: string; ref: string }> = []
  for (let i = 0, { length } = enums; i < length; i += 1) {
    const e = enums[i]!
    const enumSnake = toScreamingSnake(e.name)
    for (let j = 0, mlen = e.members.length; j < mlen; j += 1) {
      const mem = e.members[j]!
      constantEntries.push({
        key: `${enumSnake}_${toScreamingSnake(mem.name)}`,
        ref: `${e.name}.${mem.name}`,
      })
    }
  }
  // Global ASCII sort for the same generator-satisfies-the-sort-lint reason
  // as the per-enum member sort above.
  constantEntries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  for (let i = 0, { length } = constantEntries; i < length; i += 1) {
    const entry = constantEntries[i]!
    lines.push(`  ${entry.key}: ${entry.ref},`)
  }
  lines.push('}')
  lines.push('')
  lines.push('export { constants }')
  lines.push(
    '// oxlint-disable-next-line socket/no-default-export -- wrapAssembly.mts + the wasm-sync inliner consume the default export as `YGEnums`.',
  )
  lines.push('export default constants')
  lines.push('')
  return lines.join('\n')
}

/**
 * Re-stamp the yoga version in wrapAssembly.mts's Lock-step provenance line
 * from the build-verified submodule version. The behavioral wrapper is still a
 * manual re-port on a yoga bump, but its version marker is build-maintained so
 * it can never silently lie about which yoga it tracks. Throws if the
 * Lock-step line is missing — that means someone removed the provenance marker
 * and the drift guard is gone. Returns whether a rewrite was needed.
 */
export async function stampWrapAssemblyVersion(
  wrapAssemblyPath: string,
  yogaVersion: string,
): Promise<boolean> {
  const text = await fs.readFile(wrapAssemblyPath, 'utf8')
  if (!WRAP_ASSEMBLY_VERSION_RE.test(text)) {
    throw new Error(
      `wrapAssembly.mts is missing its 'Lock-step from upstream … @ yoga <ver>' ` +
        `marker (${wrapAssemblyPath}); the yoga-version drift guard was removed.`,
    )
  }
  const next = text.replace(WRAP_ASSEMBLY_VERSION_RE, `$1${yogaVersion}`)
  if (next === text) {
    return false
  }
  await fs.writeFile(wrapAssemblyPath, next, 'utf8')
  return true
}

/**
 * Convert a PascalCase member name to SCREAMING_SNAKE_CASE, treating a run of
 * consecutive capitals as one token so acronyms stay whole (LTR → LTR, not
 * L_T_R; FlexStart → FLEX_START; SpaceBetween → SPACE_BETWEEN).
 */
export function toScreamingSnake(member: string): string {
  // Insert an underscore before a capital that starts a new word: either a
  // capital followed by a lowercase, or a lowercase/digit followed by a capital.
  const withBreaks = member
    // ([A-Z]+) a run of capitals (an acronym, e.g. "LTR") captured whole,
    // ([A-Z][a-z]) followed by a capital that starts a new lowercase word
    // (e.g. the "St" in "LTRStart") — split between the acronym and the word.
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // ([a-z\d]) a lowercase letter or digit, ([A-Z]) followed directly by a
    // capital (e.g. the "e"/"S" in "FlexStart") — split before the new word.
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
  return withBreaks.toUpperCase()
}

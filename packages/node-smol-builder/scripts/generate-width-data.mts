#!/usr/bin/env node
/**
 * Generate src/socketsecurity/tui/width_data.cc from Unicode 17.0.0
 * East_Asian_Width + emoji-data data files.
 *
 * Two output tables:
 *   - kWideRanges: sorted [lo, hi] inclusive pairs of code-point ranges
 *     where width = 2 (East Asian F/W *or* Emoji_Presentation). Used by
 *     the StringWidth() fast path.
 *   - kZeroWidthRanges: sorted [lo, hi] inclusive pairs where width = 0
 *     (combining marks + default-ignorable + control chars). Used to
 *     adjust the width down for ZWJ-style sequences in the common case
 *     (combining marks attached to a base character).
 *
 * Width returned by StringWidth:
 *   1 + Σ over codepoints in the string:
 *     +1 if codepoint is wide (lookup in kWideRanges)
 *     -1 if codepoint is zero-width (lookup in kZeroWidthRanges)
 *      0 otherwise
 *   ... minus 1 (the seeding "1" cancels out for empty strings).
 *
 * Re-run when Unicode bumps to a new major version.
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { httpText } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT = path.resolve(
  __dirname,
  '..',
  '..',
  'tui-infra',
  'src',
  'socketsecurity',
  'tui',
  'width_data.cc',
)

// Unicode 17.0.0. Fleet-wide alignment: ultrathink's acorn parser
// tracks 17.0 across Go / C++ (ICU 78.2) / Rust (unicode-id-start
// 1.4.0) / TS (@unicode/unicode-17.0.0). Keep in lockstep.
const UNICODE_VERSION = '17.0.0'
const EAW_URL = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/EastAsianWidth.txt`
const EMOJI_URL = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/emoji/emoji-data.txt`

const logger = getDefaultLogger()

type Range = [number, number] // [lo, hi] inclusive

export async function fetchText(url: string): Promise<string> {
  logger.info(`Fetching ${url}`)
  const response = await httpText(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.statusCode} ${response.statusText}`,
    )
  }
  return response.data
}

export function mergeRanges(input: Range[]): Range[] {
  if (input.length === 0) {
    return []
  }
  const sorted = [...input].sort((a, b) => a[0] - b[0])
  const merged: Range[] = [sorted[0]]
  for (let i = 1, { length } = sorted; i < length; i += 1) {
    const [lo, hi] = sorted[i]
    const last = merged[merged.length - 1]
    if (lo <= last[1] + 1) {
      if (hi > last[1]) {
        last[1] = hi
      }
    } else {
      merged.push([lo, hi])
    }
  }
  return merged
}

export function parseUcd(
  text: string,
  predicate: (property: string) => boolean,
): Range[] {
  const out: Range[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]
    const hashIdx = raw.indexOf('#')
    const line = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).trim()
    if (!line) {
      continue
    }
    const semiIdx = line.indexOf(';')
    if (semiIdx < 0) {
      continue
    }
    const rangePart = line.slice(0, semiIdx).trim()
    const propertyPart = line.slice(semiIdx + 1).trim()
    if (!predicate(propertyPart)) {
      continue
    }
    const dotIdx = rangePart.indexOf('..')
    let lo: number
    let hi: number
    if (dotIdx >= 0) {
      lo = parseInt(rangePart.slice(0, dotIdx), 16)
      hi = parseInt(rangePart.slice(dotIdx + 2), 16)
    } else {
      lo = parseInt(rangePart, 16)
      hi = lo
    }
    out.push([lo, hi])
  }
  return out
}

async function main() {
  const eawText = await fetchText(EAW_URL)
  const emojiText = await fetchText(EMOJI_URL)

  // Wide: EAW F/W ∪ Emoji_Presentation.
  const wideEaw = parseUcd(eawText, p => p === 'F' || p === 'W')
  const wideEmoji = parseUcd(emojiText, p => p === 'Emoji_Presentation')
  const wide = mergeRanges([...wideEaw, ...wideEmoji])

  // Zero-width approximation: control chars + combining marks +
  // default-ignorable. We don't have the full DerivedGeneralCategory
  // here, so approximate by:
  //   - C0 + C1 controls (0x00-0x1F, 0x7F-0x9F)
  //   - Zero-width joiner / non-joiner (U+200C, U+200D)
  //   - Combining diacritical marks (U+0300-U+036F)
  //   - Variation selectors (U+FE00-U+FE0F, U+E0100-U+E01EF)
  //   - U+00AD (soft hyphen, default-ignorable)
  //   - U+061C, U+180E, U+200B, U+200E-U+200F, U+202A-U+202E,
  //     U+2060-U+206F (default-ignorable bidi + format chars)
  //   - U+FFF9-U+FFFB (interlinear annotation)
  //   - Tags block (U+E0000-U+E007F)
  //
  // This is the "covers 95% of zero-width in practice" set. The full
  // DerivedGeneralCategory pass is a future tightening.
  const zeroWidth: Range[] = mergeRanges([
    [0x0000, 0x001f],
    [0x007f, 0x009f],
    [0x00ad, 0x00ad],
    [0x0300, 0x036f],
    [0x061c, 0x061c],
    [0x180e, 0x180e],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x206f],
    [0xfe00, 0xfe0f],
    [0xfff9, 0xfffb],
    [0xe0000, 0xe007f],
    [0xe0100, 0xe01ef],
  ])

  const rangesToCpp = (ranges: Range[], name: string) => {
    let out = `extern const uint32_t ${name}[][2];\n`
    out += `const uint32_t ${name}[][2] = {\n`
    for (let i = 0, { length } = ranges; i < length; i += 1) {
      const [lo, hi] = ranges[i]
      out += `    {0x${lo.toString(16)}, 0x${hi.toString(16)}},\n`
    }
    out += '};\n'
    return out
  }

  let out = ''
  out += '// Auto-generated from Unicode 16.0.0 EastAsianWidth.txt +\n'
  out += '// emoji-data.txt. Do not hand-edit; regenerate via\n'
  out += '// scripts/generate-width-data.mts.\n'
  out += '//\n'
  out += `// kWideRanges:      ${wide.length} ranges (width = 2)\n`
  out += `// kZeroWidthRanges: ${zeroWidth.length} ranges (width = 0)\n`
  out += '\n'
  out += '#include <cstddef>\n'
  out += '#include <cstdint>\n\n'
  out += 'namespace tui {\n\n'
  out += rangesToCpp(wide, 'kWideRanges')
  out += '\n'
  out += rangesToCpp(zeroWidth, 'kZeroWidthRanges')
  out += '\n'
  out += 'extern const size_t kWideRangesCount;\n'
  out += `const size_t kWideRangesCount = ${wide.length};\n\n`
  out += 'extern const size_t kZeroWidthRangesCount;\n'
  out += `const size_t kZeroWidthRangesCount = ${zeroWidth.length};\n\n`
  out += '}  // namespace tui\n'

  writeFileSync(OUTPUT, out)
  logger.success(
    `Wrote ${OUTPUT} (${wide.length} wide + ${zeroWidth.length} zero-width ranges)`,
  )
}

main().catch(err => {
  logger.fail(`Failed: ${err}`)
  process.exitCode = 1
})

#!/usr/bin/env node
/**
 * Generate src/socketsecurity/util/entities_data.cc from the
 * canonical WHATWG named character reference table.
 *
 * Source of truth: https://html.spec.whatwg.org/entities.json.
 *
 * The output is a single C++ translation unit holding three flat
 * constexpr arrays:
 *
 * - KNamePool (uint8_t[]) — concatenated entity names, sans the leading '&'.
 *   UTF-8 (== ASCII for every named reference).
 * - KValuePool (uint8_t[]) — concatenated UTF-8 codepoints each name expands to
 *   (most are 1-2 codepoints, a handful expand to two; max 6 UTF-8 bytes per
 *   entry).
 * - KEntities (EntityMeta[]) — (name_off, name_len, value_off, value_len) tuples.
 *   Sorted by name for O(log n) binary-search decode.
 *
 * Re-run when the WHATWG table changes. The output is tracked in git;
 * runtime fetches are not part of the build.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { httpJson } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT = path.resolve(
  __dirname,
  '..',
  'additions',
  'source-patched',
  'src',
  'socketsecurity',
  'util',
  'entities_data.cc',
)
const SOURCE_URL = 'https://html.spec.whatwg.org/entities.json'

const logger = getDefaultLogger()

async function main() {
  logger.info(`Fetching ${SOURCE_URL}`)
  const response =
    await httpJson<Record<string, { characters: string }>>(SOURCE_URL)
  if (!response['ok']) {
    throw new Error(
      `Failed to fetch entities.json: ${response['statusCode']} ${response['statusText']}`,
    )
  }
  const j = response['data']

  const entries = Object.entries(j)
    .map(([k, v]) => ({ name: k.slice(1), chars: v.characters }))
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const nameBuf: number[] = []
  const valBuf: number[] = []
  const meta: Array<{
    nameOff: number
    nameLen: number
    valOff: number
    valLen: number
  }> = []

  const appendUtf8 = (buf: number[], s: string) => {
    const off = buf.length
    for (const b of Buffer.from(s, 'utf8')) {
      buf.push(b)
    }
    return [off, buf.length - off] as const
  }

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]
    const [nameOff, nameLen] = appendUtf8(nameBuf, e.name)
    const [valOff, valLen] = appendUtf8(valBuf, e.chars)
    // Pool offsets are emitted as uint16_t into the generated C++ struct;
    // a pool that crosses 65 535 bytes would silently truncate and corrupt
    // every later entity lookup at runtime. Fail loud at codegen instead so
    // a future WHATWG bump can trigger an intentional struct widening.
    if (nameOff > 0xff_ff || valOff > 0xff_ff) {
      throw new Error(
        `entity pool exceeds uint16_t range (nameOff=${nameOff}, valOff=${valOff}); widen EntityMeta offsets to uint32_t`,
      )
    }
    meta.push({ nameOff, nameLen, valOff, valLen })
  }

  const bytesToCpp = (buf: number[], name: string) => {
    let out = `extern const uint8_t ${name}[];\n`
    out += `const uint8_t ${name}[] = {`
    for (let i = 0, { length } = buf; i < length; i += 1) {
      if (i % 16 === 0) {
        out += '\n    '
      }
      out += `${buf[i]},`
    }
    out += '\n};\n'
    return out
  }

  let out = ''
  out += '// Auto-generated from https://html.spec.whatwg.org/entities.json\n'
  out += '// (WHATWG HTML Living Standard named character references).\n'
  out +=
    '// Do not hand-edit; regenerate via scripts/generate-entities-data.mts.\n'
  out += '//\n'
  out += `// ${entries.length} entries. Sorted by name for binary search.\n`
  out += '\n'
  out += '#include <cstddef>\n'
  out += '#include <cstdint>\n\n'
  out += 'namespace node {\n'
  out += 'namespace socketsecurity {\n'
  out += 'namespace util {\n'
  out += 'namespace entities {\n\n'
  out += bytesToCpp(nameBuf, 'kNamePool')
  out += '\n'
  out += bytesToCpp(valBuf, 'kValuePool')
  out += '\n'
  out += 'struct EntityMeta {\n'
  out += '  uint16_t name_off;   // offset into kNamePool\n'
  out +=
    '  uint16_t name_len;   // length in bytes (UTF-8 == ASCII for entity names)\n'
  out += '  uint16_t value_off;  // offset into kValuePool\n'
  out += '  uint8_t  value_len;  // length in bytes (UTF-8)\n'
  out += '};\n\n'
  out += 'extern const size_t kEntityCount;\n'
  out += `const size_t kEntityCount = ${entries.length};\n\n`
  out += `extern const EntityMeta kEntities[${entries.length}];\n`
  out += `const EntityMeta kEntities[${entries.length}] = {\n`
  for (let i = 0, { length } = meta; i < length; i += 1) {
    const e = meta[i]
    out += `    {${e.nameOff},${e.nameLen},${e.valOff},${e.valLen}},\n`
  }
  out += '};\n\n'
  out += '}  // namespace entities\n'
  out += '}  // namespace util\n'
  out += '}  // namespace socketsecurity\n'
  out += '}  // namespace node\n'

  writeFileSync(OUTPUT, out)
  logger.success(`Wrote ${OUTPUT} (${entries.length} entries)`)
}

main().catch(err => {
  logger.fail(`Failed: ${err}`)
  process.exitCode = 1
})

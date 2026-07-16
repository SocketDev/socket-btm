/**
 * @file WPT streams allowlist loader.
 *   Parses wpt-config/wpt-streams.allowlist (TSV: `<key>\t<category>`)
 *   into the Map<key, category> shape the classifier consumes.
 *   The allowlist format is:
 *   <test-key>\t<category-text>
 *   <test-key> is either:
 *
 *   - 'file' (no colon) — the entire file is expected to fail
 *   - 'file:test name' — a specific named test is expected to fail
 */

import { readFileSync } from 'node:fs'

export function loadAllowlist(allowlistPath: string): Map<string, string> {
  const map = new Map<string, string>()
  const raw = readFileSync(allowlistPath, 'utf8')
  const lines = raw.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const rawLine = lines[i]!
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    // TSV: split on first tab; everything after is the category.
    const tabIdx = line.indexOf('\t')
    if (tabIdx < 0) {
      // Tolerate entries without a category — treat the whole line as
      // the key, blank category.
      map.set(line, '')
      continue
    }
    const key = line.slice(0, tabIdx).trim()
    const category = line.slice(tabIdx + 1).trim()
    if (key) {
      map.set(key, category)
    }
  }
  return map
}

/**
 * @file Test262 frontmatter parser.
 *   Test262 metadata: /_--- ... ---_\/ YAML block. Hand-rolled
 *   minimal parser — Temporal subset has no $INCLUDE expansion and a
 *   stable frontmatter shape (description/esid/features/flags/includes/
 *   negative). Full YAML is overkill.
 */

import type { TestAttrs } from './types.mts'

export function parseFrontmatter(source: string): TestAttrs {
  const match = source.match(/\/\*---([\s\S]*?)---\*\//)
  if (!match) {
    return {}
  }
  const yaml = match[1]
  const attrs: TestAttrs = {}

  const descMatch = yaml.match(/^description:\s*([^\n]+)/m)
  if (descMatch) {
    attrs.description = descMatch[1].trim().replace(/^["']|["']$/g, '')
  }
  const esidMatch = yaml.match(/^esid:\s*([^\n]+)/m)
  if (esidMatch) {
    attrs.esid = esidMatch[1].trim()
  }

  attrs.features = parseList(yaml, 'features')
  attrs.includes = parseList(yaml, 'includes')

  const flags = parseList(yaml, 'flags')
  attrs.flags = flags
  if (flags) {
    attrs.raw = flags.includes('raw')
    attrs.module = flags.includes('module')
    attrs.async = flags.includes('async')
    attrs.noStrict = flags.includes('noStrict')
    attrs.onlyStrict = flags.includes('onlyStrict')
  }

  const negMatch = yaml.match(/^negative:\s*\n((?:[ \t]+[^\n]+\n?)+)/m)
  if (negMatch) {
    const negBlock = negMatch[1]
    const phaseMatch = negBlock.match(/phase:\s*([^\n]+)/)
    const typeMatch = negBlock.match(/type:\s*([^\n]+)/)
    if (phaseMatch && typeMatch) {
      attrs.negative = {
        phase: phaseMatch[1].trim(),
        type: typeMatch[1].trim(),
      }
    }
  }

  return attrs
}

export function parseList(yaml: string, key: string): string[] | undefined {
  const inlineMatch = yaml.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'))
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }
  const blockMatch = yaml.match(
    new RegExp(`^${key}:\\s*\\n((?:[ \\t]+-[^\\n]+\\n?)+)`, 'm'),
  )
  if (blockMatch) {
    return blockMatch[1]
      .split('\n')
      .map(line => line.replace(/^[ \t]*-\s*/, '').trim())
      .filter(Boolean)
  }
  return undefined
}

import { describe, expect, it } from 'vitest'

import {
  parseEnumHeader,
  renderEnumsModule,
  toScreamingSnake,
} from '../scripts/source-cloned/shared/generate-enums.mts'

describe('toScreamingSnake', () => {
  it('splits PascalCase on word boundaries', () => {
    expect(toScreamingSnake('FlexStart')).toBe('FLEX_START')
    expect(toScreamingSnake('SpaceBetween')).toBe('SPACE_BETWEEN')
    expect(toScreamingSnake('Auto')).toBe('AUTO')
  })

  it('keeps trailing acronyms whole', () => {
    expect(toScreamingSnake('LTR')).toBe('LTR')
    expect(toScreamingSnake('RTL')).toBe('RTL')
  })

  it('handles acronym-then-word', () => {
    // Not present in yoga today, but the splitter must not mangle it.
    expect(toScreamingSnake('HTMLParser')).toBe('HTML_PARSER')
  })
})

describe('parseEnumHeader', () => {
  it('assigns sequential values from 0 when no explicit value', () => {
    const header = `YG_ENUM_DECL(
      YGAlign,
      YGAlignAuto,
      YGAlignFlexStart,
      YGAlignCenter)`
    const [parsed] = parseEnumHeader(header)
    expect(parsed!.name).toBe('Align')
    expect(parsed!.members).toEqual([
      { name: 'Auto', value: 0 },
      { name: 'FlexStart', value: 1 },
      { name: 'Center', value: 2 },
    ])
  })

  it('honors explicit values and resumes counting from them', () => {
    // YGErrata is a bitmask enum: explicit, non-sequential values.
    const header = `YG_ENUM_DECL(
      YGErrata,
      YGErrataNone = 0,
      YGErrataStretchFlexBasis = 1,
      YGErrataAbsolutePercentAgainstInnerSize = 4,
      YGErrataAll = 2147483647,
      YGErrataClassic = 2147483646)`
    const [parsed] = parseEnumHeader(header)
    expect(parsed!.name).toBe('Errata')
    expect(parsed!.members).toEqual([
      { name: 'None', value: 0 },
      { name: 'StretchFlexBasis', value: 1 },
      { name: 'AbsolutePercentAgainstInnerSize', value: 4 },
      { name: 'All', value: 2_147_483_647 },
      { name: 'Classic', value: 2_147_483_646 },
    ])
  })

  it('parses multiple enum blocks', () => {
    const header = `YG_ENUM_DECL(
      YGDimension,
      YGDimensionWidth,
      YGDimensionHeight)
    YG_ENUM_DECL(
      YGDirection,
      YGDirectionInherit,
      YGDirectionLTR,
      YGDirectionRTL)`
    const parsed = parseEnumHeader(header)
    expect(parsed.map(e => e.name)).toEqual(['Dimension', 'Direction'])
    expect(parsed[1]!.members).toEqual([
      { name: 'Inherit', value: 0 },
      { name: 'LTR', value: 1 },
      { name: 'RTL', value: 2 },
    ])
  })

  it('strips // comments inside the decl body', () => {
    const header = `YG_ENUM_DECL(
      YGGutter,
      YGGutterColumn, // gap between columns
      YGGutterRow)`
    const [parsed] = parseEnumHeader(header)
    expect(parsed!.members).toEqual([
      { name: 'Column', value: 0 },
      { name: 'Row', value: 1 },
    ])
  })
})

describe('renderEnumsModule', () => {
  const enums = parseEnumHeader(`YG_ENUM_DECL(
    YGDirection,
    YGDirectionInherit,
    YGDirectionLTR,
    YGDirectionRTL)`)
  const out = renderEnumsModule(enums, 'v3.2.1')

  it('emits a per-enum const export', () => {
    expect(out).toContain('export const Direction = {')
    expect(out).toContain('  Inherit: 0,')
    expect(out).toContain('  LTR: 1,')
  })

  it('emits the flat SCREAMING_SNAKE constants table', () => {
    expect(out).toContain('DIRECTION_INHERIT: Direction.Inherit,')
    expect(out).toContain('DIRECTION_LTR: Direction.LTR,')
  })

  it('emits both named and default exports of constants', () => {
    expect(out).toContain('export { constants }')
    expect(out).toContain('export default constants')
  })

  it('marks itself generated', () => {
    expect(out).toContain('GENERATED from upstream yoga/YGEnums.h')
  })
})

/**
 * @fileoverview Test262 summary reporter.
 *
 * Prints the human-readable summary at end of run. Pure presentation
 * — no I/O beyond stdout via the fleet logger.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import type { Summary, Test } from './types.mts'

const logger = getDefaultLogger()

export function report(summary: Summary): void {
  const goodNews = [
    `${summary.allowed.success.length} tests passed (no error expected, none thrown)`,
    `${summary.allowed.failure.length} tests passed (error expected, expected error thrown)`,
    `${summary.allowed.falsePositive.length} tests classified as falsePositive but allowlisted`,
    `${summary.allowed.falseNegative.length} tests classified as falseNegative but allowlisted`,
    `${summary.skipped.length} tests skipped`,
  ]

  const badSections: Array<{ tests: Test[] | string[]; label: string }> = [
    {
      tests: summary.disallowed.success,
      label: 'tests passed despite being in the allowlist (remove the entry)',
    },
    {
      tests: summary.disallowed.failure,
      label:
        'tests threw expected error despite being in the allowlist (remove the entry)',
    },
    {
      tests: summary.disallowed.falsePositive,
      label:
        'tests expected to throw, did not (regression — add to allowlist or fix)',
    },
    {
      tests: summary.disallowed.falseNegative,
      label: 'tests threw unexpectedly (regression — add to allowlist or fix)',
    },
    {
      tests: summary.unrecognized,
      label: 'allowlist entries did not match any test (stale — remove)',
    },
  ]

  logger.log('')
  logger.log('═══════════════════════════════════════════════════════')
  logger.log(
    `Test262 Temporal subset summary (${(summary.durationMs / 1000).toFixed(1)}s)`,
  )
  logger.log('═══════════════════════════════════════════════════════')
  for (let i = 0; i < goodNews.length; i++) {
    logger.success(goodNews[i]!)
  }

  if (!summary.passed) {
    logger.log('')
    logger.log('Disallowed results:')
    for (let i = 0, { length } = badSections; i < length; i += 1) {
      const section = badSections[i]
      if (section.tests.length === 0) {
        continue
      }
      logger.warn(` ✘ ${section.tests.length} ${section.label}`)
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const t of section.tests) {
        const line = typeof t === 'string' ? t : `${t.file} (${t.scenario})`
        logger.log(`   ${line}`)
      }
    }
  }
}

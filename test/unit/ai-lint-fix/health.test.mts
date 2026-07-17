import { expect, test } from 'vitest'

import { classifyAiFailure } from '../../../scripts/fleet/ai-lint-fix/health.mts'

test('classifies an unsupported CLI option as a tool-policy failure', () => {
  expect(
    classifyAiFailure('', "error: unknown option '--no-session-persistence'"),
  ).toMatchObject({ kind: 'tool-policy' })
})

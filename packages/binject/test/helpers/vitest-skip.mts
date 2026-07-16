/**
 * Conditional-describe helper for binject tests.
 *
 * A file-local `const describeOnMac = condition ? describe : describe.skip`
 * is indistinguishable from an unimported vitest global to
 * `socket/require-vitest-globals-import` (the rule only recognizes a
 * describe-shaped callee as safe when it is imported from somewhere, not when
 * it is a same-file const alias). Importing the wrapper FUNCTION instead
 * keeps the call site a real import binding.
 */

import { describe } from 'vitest'

export function describeIf(condition: boolean) {
  return condition ? describe : describe.skip
}

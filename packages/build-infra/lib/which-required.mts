/**
 * PATH lookup that fails loud when the binary is missing.
 *
 * `which()` from lib-stable is tolerant — it returns `null` for a missing
 * binary. Build steps that cannot proceed without a tool need that surfaced
 * as an actionable error instead of a downstream spawn failure on a null
 * command.
 */

import { which } from '@socketsecurity/lib-stable/bin/which'

/**
 * Resolve a binary on PATH, throwing when it cannot be found.
 */
export async function whichRequired(binName: string): Promise<string> {
  const found = await which(binName)
  const binPath = Array.isArray(found) ? found[0] : found
  if (!binPath) {
    throw new Error(
      `Required binary not found: '${binName}'. ` +
        'PATH lookup returned nothing; wanted an executable path. ' +
        `Install '${binName}' and re-run.`,
    )
  }
  return binPath
}

/**
 * Public API for boringssl-builder (skeleton).
 *
 * Mirrors lief-builder's ensure-lief shape: local-build → already-downloaded
 * → fetch-prebuilt fall-through via build-infra/lib/ensure-prebuilt.
 *
 * Skeleton: returns the local build output path once the build script
 * has produced libsmol_crypto.a / libsmol_ssl.a there. Replace with the
 * full ensurePrebuilt() factory wiring once the trusted-publisher stubs
 * (@socketbin/boringssl-<platform-arch>) ship.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getPaths } from '../scripts/paths.mts'

export function ensureBoringssl(): string {
  const { outFinal } = getPaths()
  const libDir = path.join(outFinal, 'lib')
  if (!existsSync(libDir)) {
    throw new Error(
      `boringssl-builder artifact not found at ${libDir}; run \`pnpm --filter boringssl-builder build\``,
    )
  }
  return outFinal
}

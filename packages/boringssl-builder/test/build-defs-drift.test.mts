/**
 * Asserts docker/build.sh stays in sync with what an emit run would
 * produce from build-step-defs.mts.
 *
 * Per fleet rule "1 path, 1 reference" — build-step-defs.mts is the
 * canonical source. If this test fails, run:
 *
 * Pnpm --filter boringssl-builder run emit-docker-build.
 *
 * To regenerate docker/build.sh, then commit the regenerated file.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { emitDockerBuildScript } from '../scripts/emit-docker-build.mts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(HERE, '..')

describe('docker/build.sh drift check', () => {
  it('matches the emit output from build-step-defs.mts', () => {
    const emitted = emitDockerBuildScript()
    const onDisk = readFileSync(
      path.join(PACKAGE_ROOT, 'docker', 'build.sh'),
      'utf8',
    )
    if (emitted !== onDisk) {
      // Surface the diff path in the failure message so the operator
      // knows exactly what to run.
      expect(
        emitted,
        'docker/build.sh out of sync — run `pnpm --filter boringssl-builder run emit-docker-build`',
      ).toBe(onDisk)
    }
  })

  it('emitted script starts with the DO-NOT-EDIT marker', () => {
    const emitted = emitDockerBuildScript()
    expect(emitted.split('\n')[1]).toMatch(/DO NOT EDIT/)
  })

  it('emitted script invokes cmake', () => {
    const emitted = emitDockerBuildScript()
    expect(emitted).toContain('cmake -S $UPSTREAM_DIR')
    expect(emitted).toContain('cmake --build $CMAKE_BUILD_DIR')
  })

  it('emitted script enforces required env vars via :? expansion', () => {
    const emitted = emitDockerBuildScript()
    expect(emitted).toContain('${UPSTREAM_DIR:?')
    expect(emitted).toContain('${CMAKE_BUILD_DIR:?')
    expect(emitted).toContain('${OUT_LIB_DIR:?')
    expect(emitted).toContain('${OUT_INCLUDE_DIR:?')
  })
})

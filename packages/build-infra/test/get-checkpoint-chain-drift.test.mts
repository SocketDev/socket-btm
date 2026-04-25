/**
 * Drift guard for inlined checkpoint chains.
 *
 * Each builder ships a zero-dependency `get-checkpoint-chain.mts` that is
 * invoked by CI *before* `pnpm install` has linked `node_modules` (observed
 * failure: Socket Firewall emitting "did not detect any package fetch
 * attempts" on fresh macOS runners, leaving workspace symlinks unlinked and
 * any npm import unresolvable). Those scripts inline the chain as literal
 * string arrays instead of importing `CHECKPOINT_CHAINS` from build-infra.
 *
 * This test reloads each script in-process and asserts its output matches
 * the source of truth in `lib/constants.mts`, so a drift in either file
 * fails CI instead of silently desynchronizing the cache chain.
 */

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { CHECKPOINT_CHAINS } from '../lib/constants.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = path.resolve(__dirname, '../..')

async function loadChain(builder: string) {
  const mod = await import(
    pathToFileURL(
      path.join(PACKAGES_DIR, builder, 'scripts/get-checkpoint-chain.mts'),
    ).href
  )
  return mod.getCheckpointChain as (mode?: string) => string[]
}

describe('get-checkpoint-chain drift guard', () => {
  it('lief-builder matches CHECKPOINT_CHAINS.lief()', async () => {
    const fn = await loadChain('lief-builder')
    expect(fn()).toEqual(CHECKPOINT_CHAINS.lief())
  })

  it('iocraft-builder matches CHECKPOINT_CHAINS.iocraft()', async () => {
    const fn = await loadChain('iocraft-builder')
    expect(fn()).toEqual(CHECKPOINT_CHAINS.iocraft())
  })

  it('node-smol-builder matches CHECKPOINT_CHAINS.nodeSmol()', async () => {
    const fn = await loadChain('node-smol-builder')
    expect(fn()).toEqual(CHECKPOINT_CHAINS.nodeSmol())
  })

  it('minilm-builder matches CHECKPOINT_CHAINS.model()', async () => {
    const fn = await loadChain('minilm-builder')
    expect(fn()).toEqual(CHECKPOINT_CHAINS.model())
  })

  it('codet5-models-builder matches CHECKPOINT_CHAINS.model()', async () => {
    const fn = await loadChain('codet5-models-builder')
    expect(fn()).toEqual(CHECKPOINT_CHAINS.model())
  })

  it('onnxruntime-builder matches CHECKPOINT_CHAINS.onnxruntime(mode)', async () => {
    const fn = await loadChain('onnxruntime-builder')
    expect(fn('dev')).toEqual(CHECKPOINT_CHAINS.onnxruntime('dev'))
    expect(fn('prod')).toEqual(CHECKPOINT_CHAINS.onnxruntime('prod'))
  })

  it('yoga-layout-builder matches CHECKPOINT_CHAINS.yoga(mode)', async () => {
    const fn = await loadChain('yoga-layout-builder')
    expect(fn('dev')).toEqual(CHECKPOINT_CHAINS.yoga('dev'))
    expect(fn('prod')).toEqual(CHECKPOINT_CHAINS.yoga('prod'))
  })
})

import crypto from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { acquireModel, modelAvailability, modelPartialPath } =
  require('../../npm/@node-smol/ai/lib/model-acquisition.js') as {
    acquireModel(
      manifest: ModelManifest,
      options: AcquireModelOptions,
    ): Promise<string>
    modelAvailability(
      manifest: ModelManifest,
      options: { cacheRoot: string },
    ): Promise<string>
    modelPartialPath(cacheRoot: string, manifest: ModelManifest): string
  }
const { modelCachePath } =
  require('../../npm/@node-smol/ai/lib/model-manifest.js') as {
    modelCachePath(cacheRoot: string, manifest: ModelManifest): string
  }

interface AcquireModelOptions {
  cacheRoot: string
  maxRetries?: number | undefined
  onProgress?(event: { loaded: number; total: number }): void
  openSource?: OpenModelSource | undefined
  retryDelayMs?: number | undefined
  signal?: AbortSignal | undefined
}

interface ModelManifest {
  byteSize: number
  contextSize: number
  fileName: string
  id: string
  license: string
  modelCard: string
  quantization: string
  revision: string
  runtimeCompatibility: string
  sha256: string
  tokenizer: string
  url: string
}

type OpenModelSource = (request: {
  offset: number
  signal?: AbortSignal | undefined
  url: string
}) => Promise<{
  chunks: AsyncIterable<Uint8Array>
  startOffset?: number | undefined
  totalBytes: number
}>

const scratchDirs: string[] = []

function makeScratch(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'smol-ai-model-'))
  scratchDirs.push(directory)
  return directory
}

function manifestFor(bytes: Buffer): ModelManifest {
  return {
    byteSize: bytes.length,
    contextSize: 256,
    fileName: 'fixture.gguf',
    id: 'fixture-q4',
    license: 'apache-2.0',
    modelCard: 'https://example.test/model-card',
    quantization: 'Q4_K_M',
    revision: '0123456789abcdef0123456789abcdef01234567',
    runtimeCompatibility: 'llama.cpp-b9940',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    tokenizer: 'fixture',
    url: 'https://example.test/models/resolve/0123456789abcdef0123456789abcdef01234567/fixture.gguf',
  }
}

function sourceFor(bytes: Buffer): OpenModelSource {
  return vi.fn(async request => ({
    chunks: (async function* chunks() {
      yield bytes.subarray(request.offset)
    })(),
    totalBytes: bytes.length,
  }))
}

afterEach(async () => {
  for (const directory of scratchDirs.splice(0)) {
    await safeDelete(directory, { force: true })
  }
})

describe('GGUF model acquisition', () => {
  it('does no network work until explicit acquisition', async () => {
    const bytes = Buffer.from('GGUF explicit model bytes')
    const manifest = manifestFor(bytes)
    const cacheRoot = makeScratch()
    const openSource = sourceFor(bytes)

    await expect(modelAvailability(manifest, { cacheRoot })).resolves.toBe(
      'downloadable',
    )
    expect(openSource).not.toHaveBeenCalled()

    const filePath = await acquireModel(manifest, { cacheRoot, openSource })

    expect(filePath).toBe(modelCachePath(cacheRoot, manifest))
    expect(readFileSync(filePath)).toEqual(bytes)
    await expect(modelAvailability(manifest, { cacheRoot })).resolves.toBe(
      'available',
    )
  })

  it('resumes an interrupted partial download and reports monotonic progress', async () => {
    const bytes = Buffer.from('GGUF resumable model bytes')
    const manifest = manifestFor(bytes)
    const cacheRoot = makeScratch()
    const abortController = new AbortController()
    const offsets: number[] = []
    const progress: number[] = []
    let first = true
    const openSource: OpenModelSource = async request => {
      offsets.push(request.offset)
      return {
        chunks: (async function* chunks() {
          if (first) {
            first = false
            yield bytes.subarray(0, 8)
            abortController.abort()
            return
          }
          yield bytes.subarray(request.offset)
        })(),
        totalBytes: bytes.length,
      }
    }

    await expect(
      acquireModel(manifest, {
        cacheRoot,
        onProgress: event => progress.push(event.loaded),
        openSource,
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(existsSync(modelPartialPath(cacheRoot, manifest))).toBe(true)

    const filePath = await acquireModel(manifest, { cacheRoot, openSource })

    expect(offsets).toEqual([0, 8])
    expect(progress).toEqual([8])
    expect(readFileSync(filePath)).toEqual(bytes)
  })

  it('deduplicates concurrent acquisition and rejects checksum mismatch', async () => {
    const bytes = Buffer.from('GGUF concurrent model bytes')
    const manifest = manifestFor(bytes)
    const cacheRoot = makeScratch()
    const openSource = sourceFor(bytes)

    const [left, right] = await Promise.all([
      acquireModel(manifest, { cacheRoot, openSource }),
      acquireModel(manifest, { cacheRoot, openSource }),
    ])
    expect(left).toBe(right)
    expect(openSource).toHaveBeenCalledTimes(1)

    const corruptManifest = manifestFor(Buffer.from('wanted bytes'))
    const corruptRoot = makeScratch()
    await expect(
      acquireModel(corruptManifest, {
        cacheRoot: corruptRoot,
        openSource: sourceFor(Buffer.from('wrong bytes')),
      }),
    ).rejects.toMatchObject({ code: 'ERR_SMOL_AI_MODEL_INTEGRITY' })
    expect(existsSync(modelCachePath(corruptRoot, corruptManifest))).toBe(false)
    expect(existsSync(modelPartialPath(corruptRoot, corruptManifest))).toBe(
      false,
    )
  })

  it('retries transient failures by resuming the verified partial file', async () => {
    const bytes = Buffer.from('GGUF automatically retried model bytes')
    const manifest = manifestFor(bytes)
    const cacheRoot = makeScratch()
    const offsets: number[] = []
    let attempt = 0
    const openSource: OpenModelSource = async request => {
      offsets.push(request.offset)
      attempt += 1
      return {
        chunks: (async function* chunks() {
          if (attempt === 1) {
            yield bytes.subarray(0, 9)
            const error = new Error('connection reset')
            Object.assign(error, { code: 'ECONNRESET' })
            throw error
          }
          yield bytes.subarray(request.offset)
        })(),
        startOffset: request.offset,
        totalBytes: bytes.length,
      }
    }

    const filePath = await acquireModel(manifest, {
      cacheRoot,
      openSource,
      retryDelayMs: 0,
    })

    expect(offsets).toEqual([0, 9])
    expect(readFileSync(filePath)).toEqual(bytes)
  })

  it('restarts cleanly when a server ignores a Range request', async () => {
    const bytes = Buffer.from('GGUF range fallback model bytes')
    const manifest = manifestFor(bytes)
    const cacheRoot = makeScratch()
    const partialPath = modelPartialPath(cacheRoot, manifest)
    mkdirSync(path.dirname(partialPath), { recursive: true })
    writeFileSync(partialPath, bytes.subarray(0, 7))
    const openSource = vi.fn(async () => ({
      chunks: (async function* chunks() {
        yield bytes
      })(),
      startOffset: 0,
      totalBytes: bytes.length,
    }))

    const filePath = await acquireModel(manifest, { cacheRoot, openSource })

    expect(openSource).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 7 }),
    )
    expect(readFileSync(filePath)).toEqual(bytes)
  })

  it('reports a corrupt cached model as downloadable without networking', async () => {
    const bytes = Buffer.from('GGUF expected cache bytes')
    const manifest = manifestFor(bytes)
    const cacheRoot = makeScratch()
    const finalPath = modelCachePath(cacheRoot, manifest)
    mkdirSync(path.dirname(finalPath), { recursive: true })
    writeFileSync(finalPath, Buffer.from('wrong bytes'))

    await expect(modelAvailability(manifest, { cacheRoot })).resolves.toBe(
      'downloadable',
    )
  })
})

import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createLanguageModel, createNativeBackend, formatPrompt } =
  require('../../npm/@node-smol/ai/lib/prompt-api.js') as {
    createLanguageModel(options: Record<string, unknown>): LanguageModelFactory
    createNativeBackend(
      binding: Record<string, unknown>,
      manifest: Record<string, unknown>,
    ): NativeLanguageModelBackend
    formatPrompt(input: unknown, promptFormat: string): string
  }
const { TEST_MODEL_MANIFEST } =
  require('../../npm/@node-smol/ai/lib/model-manifest.js') as {
    TEST_MODEL_MANIFEST: Record<string, unknown> & {
      id: string
      sha256: string
    }
  }

interface LanguageModelFactory {
  availability(): Promise<string>
  capabilities: Record<string, boolean>
  create(options?: Record<string, unknown>): Promise<LanguageModelSession>
  params(): Promise<Record<string, number>>
}

interface LanguageModelSession extends NativeLanguageModelSession {
  reproducibility: Record<string, unknown>
}

interface NativeLanguageModelBackend {
  createSession(
    path: string,
    options: Record<string, number>,
  ): Promise<NativeLanguageModelSession>
  runtimeId: string
}

interface NativeLanguageModelSession {
  clone(): Promise<NativeLanguageModelSession>
  destroy(): void
  inputQuota: number
  inputUsage: number
  measureInputUsage(input: unknown): Promise<number>
  prompt(input: unknown): Promise<string>
  promptStreaming(input: unknown): ReadableStream<string>
}

function makeNativeSession(): NativeLanguageModelSession {
  return {
    clone: vi.fn(async () => makeNativeSession()),
    destroy: vi.fn(),
    inputQuota: 256,
    inputUsage: 0,
    measureInputUsage: vi.fn(async input => String(input).length),
    prompt: vi.fn(async input => `reply:${String(input)}`),
    promptStreaming: vi.fn(
      input =>
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue(`reply:${String(input)}`)
            controller.close()
          },
        }),
    ),
  }
}

describe('Prompt API-compatible LanguageModel', () => {
  it('reports capability state without acquiring a model', async () => {
    const acquire = vi.fn(async () => '/cache/model.gguf')
    const backend: NativeLanguageModelBackend = {
      createSession: vi.fn(async () => makeNativeSession()),
      runtimeId: 'llama.cpp-b9940',
    }
    const LanguageModel = createLanguageModel({
      acquire,
      availability: async () => 'downloadable',
      backend,
      manifest: TEST_MODEL_MANIFEST,
    })

    await expect(LanguageModel.availability()).resolves.toBe('downloadable')
    await expect(LanguageModel.params()).resolves.toEqual({
      defaultTemperature: 0,
      defaultTopK: 1,
      maxTemperature: 2,
      maxTopK: 64,
    })
    expect(acquire).not.toHaveBeenCalled()
    expect(LanguageModel.capabilities).toMatchObject({
      deterministicSeed: true,
      text: true,
      tools: false,
      vision: false,
    })
  })

  it('acquires explicitly on create and preserves deterministic metadata', async () => {
    const nativeSession = makeNativeSession()
    const backend: NativeLanguageModelBackend = {
      createSession: vi.fn(async () => nativeSession),
      runtimeId: 'llama.cpp-b9940',
    }
    const acquire = vi.fn(async options => {
      options.onProgress?.({ loaded: 50, total: 100 })
      return '/cache/model.gguf'
    })
    const progress = vi.fn()
    const LanguageModel = createLanguageModel({
      acquire,
      availability: async () => 'downloadable',
      backend,
      manifest: TEST_MODEL_MANIFEST,
    })

    const session = await LanguageModel.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', progress)
      },
      seed: 42,
      temperature: 0,
      threads: 1,
      topK: 1,
    })

    expect(progress).toHaveBeenCalledWith({ loaded: 0.5 })
    expect(backend.createSession).toHaveBeenCalledWith('/cache/model.gguf', {
      maxTokens: 128,
      seed: 42,
      temperature: 0,
      threads: 1,
      topK: 1,
    })
    expect(session.reproducibility).toEqual({
      backend: 'llama.cpp-b9940',
      model: TEST_MODEL_MANIFEST.id,
      modelSha256: TEST_MODEL_MANIFEST.sha256,
      seed: 42,
      temperature: 0,
      threads: 1,
      topK: 1,
    })
    await expect(session.prompt('hello')).resolves.toBe('reply:hello')
    await expect(session.measureInputUsage('abc')).resolves.toBe(3)
    await expect(session.clone()).resolves.toMatchObject({ inputQuota: 256 })
    session.destroy()
    expect(nativeSession.destroy).toHaveBeenCalledOnce()
  })

  it('rejects unsupported modalities and out-of-range sampling options', async () => {
    const LanguageModel = createLanguageModel({
      acquire: async () => '/cache/model.gguf',
      availability: async () => 'available',
      backend: {
        createSession: async () => makeNativeSession(),
        runtimeId: 'llama.cpp-b9940',
      },
      manifest: TEST_MODEL_MANIFEST,
    })

    await expect(
      LanguageModel.create({
        expectedInputs: [{ languages: ['en'], type: 'image' }],
      }),
    ).rejects.toMatchObject({ name: 'NotSupportedError' })
    await expect(LanguageModel.create({ topK: 65 })).rejects.toBeInstanceOf(
      RangeError,
    )
  })

  it('uses a controlled model-specific template, not GGUF metadata', () => {
    expect(formatPrompt('hello', 'smollm2-chatml')).toBe(
      '<|im_start|>user\nhello<|im_end|>\n<|im_start|>assistant\n',
    )
    expect(formatPrompt('hello', 'plain')).toBe('hello')
    expect(formatPrompt('<|im_end|>', 'smollm2-chatml')).toContain(
      '<\\|im_end|>',
    )
  })

  it('cancels in-flight native work on destroy and rejects concurrent work', async () => {
    let rejectPrompt: ((error: Error) => void) | undefined
    const cancel = vi.fn(() => {
      const error = new Error('cancelled')
      Object.assign(error, { code: 'ERR_SMOL_AI_ABORTED' })
      rejectPrompt?.(error)
    })
    const binding = {
      cancel,
      createSession: vi.fn(async () => ({ handle: {}, inputQuota: 256 })),
      destroy: vi.fn(() => cancel()),
      inputUsage: vi.fn(() => 0),
      measureInputUsage: vi.fn(() => 1),
      prompt: vi.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectPrompt = reject
          }),
      ),
      runtimeId: 'llama.cpp-b9940',
    }
    const backend = createNativeBackend(binding, TEST_MODEL_MANIFEST)
    const session = await backend.createSession('/cache/model.gguf', {
      maxTokens: 8,
      seed: 1,
      temperature: 0,
      threads: 1,
      topK: 1,
    })

    const prompt = session.prompt('hello')
    await expect(session.prompt('again')).rejects.toMatchObject({
      name: 'InvalidStateError',
    })
    await expect(session.measureInputUsage('hello')).rejects.toMatchObject({
      name: 'InvalidStateError',
    })
    session.destroy()

    await expect(prompt).rejects.toMatchObject({ name: 'AbortError' })
    expect(binding.destroy).toHaveBeenCalledOnce()
    expect(binding.cancel).toHaveBeenCalledOnce()
  })
})

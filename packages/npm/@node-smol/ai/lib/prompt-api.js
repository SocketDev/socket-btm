'use strict'

const PARAMS = Object.freeze({
  defaultTemperature: 0,
  defaultTopK: 1,
  maxTemperature: 2,
  maxTopK: 64,
})

function abortError(message = 'Language model operation was aborted') {
  return new DOMException(message, 'AbortError')
}

function assertActive(destroyed) {
  if (destroyed) {
    throw new DOMException(
      'Language model session is destroyed',
      'InvalidStateError',
    )
  }
}

function assertModality(modalities, field) {
  if (modalities?.some(modality => modality.type !== 'text')) {
    throw new DOMException(
      `node:smol-ai supports text-only ${field}`,
      'NotSupportedError',
    )
  }
}

function createLanguageModel(options) {
  const { acquire, availability, backend, manifest } = {
    __proto__: null,
    ...options,
  }
  return Object.freeze({
    async availability() {
      return await availability()
    },
    capabilities: Object.freeze({
      deterministicSeed: true,
      text: true,
      tools: false,
      vision: false,
    }),
    async create(createOptions) {
      const opts = { __proto__: null, ...createOptions }
      assertModality(opts.expectedInputs, 'inputs')
      assertModality(opts.expectedOutputs, 'outputs')
      if (opts.signal?.aborted) {
        throw abortError('Language model creation was aborted')
      }
      const seed = opts.seed ?? 0
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0x7f_ff_ff_ff) {
        throw new RangeError(
          'seed must be an integer from 0 through 2147483647',
        )
      }
      const nativeOptions = {
        maxTokens: integerOption(
          opts.maxTokens,
          Math.min(512, Math.floor(manifest.contextSize / 2)),
          'maxTokens',
          manifest.contextSize,
        ),
        seed,
        temperature: numberOption(
          opts.temperature,
          PARAMS.defaultTemperature,
          'temperature',
          PARAMS.maxTemperature,
        ),
        threads: integerOption(opts.threads, 1, 'threads', 256),
        topK: integerOption(
          opts.topK,
          PARAMS.defaultTopK,
          'topK',
          PARAMS.maxTopK,
        ),
      }
      const listeners = new Set()
      opts.monitor?.({
        addEventListener(type, listener) {
          if (type === 'downloadprogress') {
            listeners.add(listener)
          }
        },
      })
      const modelPath = await acquire({
        onProgress(event) {
          const progress = {
            loaded: event.total ? event.loaded / event.total : 0,
          }
          for (const listener of listeners) {
            listener(progress)
          }
        },
        signal: opts.signal,
      })
      if (opts.signal?.aborted) {
        throw abortError('Language model creation was aborted')
      }
      const nativeSession = await backend.createSession(
        modelPath,
        nativeOptions,
      )
      if (opts.signal?.aborted) {
        nativeSession.destroy()
        throw abortError('Language model creation was aborted')
      }
      return wrapSession(nativeSession, {
        backend: backend.runtimeId,
        model: manifest.id,
        modelSha256: manifest.sha256,
        seed: nativeOptions.seed,
        temperature: nativeOptions.temperature,
        threads: nativeOptions.threads,
        topK: nativeOptions.topK,
      })
    },
    async params() {
      return PARAMS
    },
  })
}

function createNativeBackend(binding, manifest) {
  const backend = {
    async createSession(modelPath, options) {
      const opts = { __proto__: null, ...options }
      const native = await binding.createSession(modelPath, opts)
      let destroyed = false
      let pending = false

      const session = {
        async clone() {
          assertActive(destroyed)
          if (pending) {
            throw new DOMException(
              'Cannot clone a session while a prompt is running',
              'InvalidStateError',
            )
          }
          return await backend.createSession(modelPath, opts)
        },
        destroy() {
          if (!destroyed) {
            destroyed = true
            binding.destroy(native.handle)
          }
        },
        get inputQuota() {
          return native.inputQuota
        },
        get inputUsage() {
          assertActive(destroyed)
          return binding.inputUsage(native.handle)
        },
        async measureInputUsage(input) {
          assertActive(destroyed)
          if (pending) {
            throw new DOMException(
              'Cannot measure input while a prompt is running',
              'InvalidStateError',
            )
          }
          return binding.measureInputUsage(
            native.handle,
            formatPrompt(input, manifest.promptFormat),
          )
        },
        async prompt(input, promptOptions) {
          assertActive(destroyed)
          if (pending) {
            throw new DOMException(
              'A prompt is already running for this session',
              'InvalidStateError',
            )
          }
          if (promptOptions?.signal?.aborted) {
            throw abortError()
          }
          pending = true
          const onAbort = () => binding.cancel(native.handle)
          promptOptions?.signal?.addEventListener('abort', onAbort, {
            once: true,
          })
          try {
            return await binding.prompt(
              native.handle,
              formatPrompt(input, manifest.promptFormat),
            )
          } catch (error) {
            throw toAbortError(error)
          } finally {
            pending = false
            promptOptions?.signal?.removeEventListener('abort', onAbort)
          }
        },
        promptStreaming(input, promptOptions) {
          assertActive(destroyed)
          const streamAbort = new AbortController()
          const signal = promptOptions?.signal
            ? AbortSignal.any([promptOptions.signal, streamAbort.signal])
            : streamAbort.signal
          return new ReadableStream({
            async start(controller) {
              try {
                controller.enqueue(await session.prompt(input, { signal }))
                controller.close()
              } catch (error) {
                controller.error(error)
              }
            },
            cancel() {
              streamAbort.abort()
            },
          })
        },
      }
      return session
    },
    runtimeId: binding.runtimeId,
  }
  return Object.freeze(backend)
}

function formatPrompt(input, promptFormat) {
  const messages = promptMessages(input)
  if (promptFormat === 'plain') {
    return messages.map(message => message.content).join('\n')
  }
  if (promptFormat !== 'smollm2-chatml') {
    throw new TypeError(`Unsupported controlled prompt format: ${promptFormat}`)
  }
  const formatted = messages
    .map(message => {
      const content = message.content.replaceAll('<|', '<\\|')
      return `<|im_start|>${message.role}\n${content}<|im_end|>\n`
    })
    .join('')
  return `${formatted}<|im_start|>assistant\n`
}

function integerOption(value, fallback, name, maximum) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new RangeError(`${name} must be an integer from 1 through ${maximum}`)
  }
  return resolved
}

function numberOption(value, fallback, name, maximum) {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > maximum) {
    throw new RangeError(`${name} must be from 0 through ${maximum}`)
  }
  return resolved
}

function promptMessages(input) {
  const values = Array.isArray(input) ? input : [input]
  return values.map(value => {
    if (typeof value === 'string') {
      return { content: value, role: 'user' }
    }
    if (
      value === null ||
      typeof value !== 'object' ||
      typeof value.content !== 'string' ||
      !['assistant', 'system', 'user'].includes(value.role)
    ) {
      throw new TypeError(
        'Prompt input must be text or text messages with system, user, or assistant roles',
      )
    }
    return { content: value.content, role: value.role }
  })
}

function toAbortError(error) {
  if (error?.code === 'ERR_SMOL_AI_ABORTED') {
    return abortError()
  }
  return error
}

function wrapSession(nativeSession, reproducibility) {
  let destroyed = false
  return {
    async clone() {
      assertActive(destroyed)
      return wrapSession(await nativeSession.clone(), reproducibility)
    },
    destroy() {
      if (!destroyed) {
        destroyed = true
        nativeSession.destroy()
      }
    },
    get inputQuota() {
      return nativeSession.inputQuota
    },
    get inputUsage() {
      assertActive(destroyed)
      return nativeSession.inputUsage
    },
    measureInputUsage(input) {
      assertActive(destroyed)
      return nativeSession.measureInputUsage(input)
    },
    prompt(input, options) {
      assertActive(destroyed)
      return nativeSession.prompt(input, options)
    },
    promptStreaming(input, options) {
      assertActive(destroyed)
      return nativeSession.promptStreaming(input, options)
    },
    reproducibility,
  }
}

module.exports = Object.freeze({
  createLanguageModel,
  createNativeBackend,
  formatPrompt,
})

'use strict'

const { ObjectFreeze, SafeFinalizationRegistry, SafePromise } = primordials

const {
  acquireModel,
  defaultModelCacheRoot,
  modelAvailability,
} = require('internal/socketsecurity/ai/model-acquisition')
const {
  DEFAULT_MODEL_MANIFEST,
} = require('internal/socketsecurity/ai/model-manifest')
const {
  createLanguageModel,
  createNativeBackend,
} = require('internal/socketsecurity/ai/prompt-api')

const native = internalBinding('smol_ai')
const sessionRegistry = new SafeFinalizationRegistry(native.destroy)

function callbackPromise(invoke) {
  return new SafePromise((resolve, reject) => {
    invoke((error, value) => {
      if (error !== undefined) {
        reject(error)
      } else {
        resolve(value)
      }
    })
  })
}

const binding = ObjectFreeze({
  __proto__: null,
  cancel: native.cancel,
  createSession(modelPath, options) {
    return callbackPromise(callback => {
      native.createSession(modelPath, options, callback)
    }).then(result => {
      sessionRegistry.register(result, result.handle)
      return result
    })
  },
  destroy: native.destroy,
  inputUsage: native.inputUsage,
  measureInputUsage: native.measureInputUsage,
  prompt(handle, input) {
    return callbackPromise(callback => {
      native.prompt(handle, input, callback)
    })
  },
  runtimeId: native.runtimeId,
})

const cacheRoot = defaultModelCacheRoot()
const backend = createNativeBackend(binding, DEFAULT_MODEL_MANIFEST)
const LanguageModel = createLanguageModel({
  acquire: options =>
    acquireModel(DEFAULT_MODEL_MANIFEST, { cacheRoot, ...options }),
  availability: () =>
    modelAvailability(DEFAULT_MODEL_MANIFEST, { cacheRoot }),
  backend,
  manifest: DEFAULT_MODEL_MANIFEST,
})

module.exports = ObjectFreeze({
  __proto__: null,
  LanguageModel,
})

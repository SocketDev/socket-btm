'use strict'

const { createRequire } = require('node:module')
const {
  isMuslRuntime,
  loadNativeBinding,
  resolveNativeTarget,
} = require('./lib/native-loader.js')
const {
  acquireModel,
  defaultModelCacheRoot,
  modelAvailability,
} = require('./lib/model-acquisition.js')
const { DEFAULT_MODEL_MANIFEST } = require('./lib/model-manifest.js')
const {
  createLanguageModel,
  createNativeBackend,
} = require('./lib/prompt-api.js')

const localRequire = createRequire(__filename)
const target = resolveNativeTarget({
  arch: process.arch,
  isMusl: isMuslRuntime(),
  platform: process.platform,
})
if (!target) {
  const error = new Error(
    `@node-smol/ai has no native package for ${process.platform}-${process.arch}`,
  )
  error.code = 'ERR_SMOL_AI_UNSUPPORTED_PLATFORM'
  throw error
}

const binding = loadNativeBinding({ require: localRequire, target })
if (
  !binding ||
  typeof binding.createSession !== 'function' ||
  typeof binding.prompt !== 'function'
) {
  const error = new TypeError(
    `@node-smol/ai native package ${target} does not export its session API`,
  )
  error.code = 'ERR_SMOL_AI_INVALID_BINDING'
  throw error
}

const cacheRoot = defaultModelCacheRoot()
const backend = createNativeBackend(binding, DEFAULT_MODEL_MANIFEST)
const LanguageModel = createLanguageModel({
  acquire: options =>
    acquireModel(DEFAULT_MODEL_MANIFEST, { cacheRoot, ...options }),
  availability: () => modelAvailability(DEFAULT_MODEL_MANIFEST, { cacheRoot }),
  backend,
  manifest: DEFAULT_MODEL_MANIFEST,
})

module.exports = Object.freeze({ LanguageModel })

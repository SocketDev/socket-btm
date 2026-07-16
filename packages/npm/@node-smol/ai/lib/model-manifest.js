'use strict'

// eslint-disable-next-line unicorn/prefer-node-protocol -- this source also runs under Node's internal builtin loader, which rejects node: specifiers.
const path = require('path')

const DEFAULT_MODEL_MANIFEST = Object.freeze({
  byteSize: 105_454_432,
  contextSize: 8192,
  fileName: 'SmolLM2-135M-Instruct-Q4_K_M.gguf',
  id: 'smollm2-135m-instruct-q4-k-m@09816acd',
  license: 'apache-2.0',
  modelCard: 'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct',
  promptFormat: 'smollm2-chatml',
  quantization: 'Q4_K_M',
  revision: '09816acd5d99df7be770d85ea30822623dab342c',
  runtimeCompatibility: 'llama.cpp-b9940',
  sha256: '2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d',
  tokenizer: 'smollm-bpe',
  url: 'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/09816acd5d99df7be770d85ea30822623dab342c/SmolLM2-135M-Instruct-Q4_K_M.gguf',
})

const TEST_MODEL_MANIFEST = Object.freeze({
  byteSize: 1_185_376,
  contextSize: 256,
  fileName: 'stories260K.gguf',
  id: 'stories260k-f32@99dd1a73',
  license: 'test-fixture',
  modelCard: 'https://huggingface.co/ggml-org/tiny-llamas',
  promptFormat: 'plain',
  quantization: 'F32',
  revision: '99dd1a73db5a37100bd4ae633f4cfce6560e1567',
  runtimeCompatibility: 'llama.cpp-b9940',
  sha256: '047bf46455a544931cff6fef14d7910154c56afbc23ab1c5e56a72e69912c04b',
  tokenizer: 'llama-spm',
  url: 'https://huggingface.co/ggml-org/tiny-llamas/resolve/99dd1a73db5a37100bd4ae633f4cfce6560e1567/stories260K.gguf',
})

function modelCachePath(cacheRoot, manifest) {
  validateModelManifest(manifest)
  return path.join(cacheRoot, 'sha256', manifest.sha256, manifest.fileName)
}

function validateModelManifest(manifest) {
  if (!/^[a-f\d]{64}$/.test(manifest.sha256)) {
    throw new TypeError('GGUF model manifest must contain a lowercase SHA-256')
  }
  if (!/^[a-f\d]{40}$/.test(manifest.revision)) {
    throw new TypeError(
      'GGUF model manifest must contain a 40-character revision',
    )
  }
  if (!Number.isSafeInteger(manifest.byteSize) || manifest.byteSize < 1) {
    throw new RangeError(
      'GGUF model manifest byte size must be a positive integer',
    )
  }
  if (!Number.isSafeInteger(manifest.contextSize) || manifest.contextSize < 1) {
    throw new RangeError(
      'GGUF model manifest context size must be a positive integer',
    )
  }
  const url = new URL(manifest.url)
  if (
    url.protocol !== 'https:' ||
    !url.pathname.includes(`/resolve/${manifest.revision}/`)
  ) {
    throw new TypeError(
      'GGUF model URL must use HTTPS and contain its immutable revision',
    )
  }
  if (path.posix.basename(url.pathname) !== manifest.fileName) {
    throw new TypeError('GGUF model URL filename must match the manifest')
  }
}

module.exports = Object.freeze({
  DEFAULT_MODEL_MANIFEST,
  TEST_MODEL_MANIFEST,
  modelCachePath,
  validateModelManifest,
})

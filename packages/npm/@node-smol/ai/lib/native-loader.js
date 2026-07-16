'use strict'

const NATIVE_TARGETS = Object.freeze([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-gnu',
  'linux-arm64-musl',
  'linux-x64-gnu',
  'linux-x64-musl',
  'win32-arm64-msvc',
  'win32-x64-msvc',
])

function isMuslRuntime() {
  if (process.platform !== 'linux') {
    return false
  }
  const report = process.report?.getReport?.()
  return !report?.header?.glibcVersionRuntime
}

function loadNativeBinding(options) {
  const opts = { __proto__: null, ...options }
  if (process.env.SMOL_AI_NATIVE_PATH) {
    return opts.require(process.env.SMOL_AI_NATIVE_PATH)
  }
  const packageName = nativePackageName(opts.target)
  try {
    return opts.require(packageName)
  } catch (cause) {
    const detail =
      cause && typeof cause === 'object' && 'message' in cause
        ? String(cause.message)
        : String(cause)
    const error = new Error(`Failed to load ${packageName}: ${detail}`, {
      cause,
    })
    error.code = 'ERR_SMOL_AI_NATIVE_LOAD'
    throw error
  }
}

function nativePackageName(target) {
  return `@node-smol/ai.node-${target}`
}

function resolveNativeTarget(inputs) {
  const { arch, isMusl, platform } = { __proto__: null, ...inputs }
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return `darwin-${arch}`
  }
  if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) {
    return `linux-${arch}-${isMusl ? 'musl' : 'gnu'}`
  }
  if (platform === 'win32' && (arch === 'arm64' || arch === 'x64')) {
    return `win32-${arch}-msvc`
  }
  return undefined
}

module.exports = Object.freeze({
  NATIVE_TARGETS,
  isMuslRuntime,
  loadNativeBinding,
  nativePackageName,
  resolveNativeTarget,
})

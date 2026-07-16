'use strict'

/* eslint-disable unicorn/prefer-node-protocol -- this source also runs under Node's internal builtin loader, which rejects node: specifiers. */
const crypto = require('crypto')
const { once } = require('events')
const { createReadStream, createWriteStream, existsSync } = require('fs')
const { mkdir, rename, rm, stat } = require('fs/promises')
const https = require('https')
const os = require('os')
const path = require('path')

const modelManifestModule =
  typeof internalBinding === 'function'
    ? require('internal/socketsecurity/ai/model-manifest')
    : require('./model-manifest.js')
const { modelCachePath, validateModelManifest } = modelManifestModule

class ModelIntegrityError extends Error {
  constructor(message) {
    super(message)
    this.code = 'ERR_SMOL_AI_MODEL_INTEGRITY'
    this.name = 'ModelIntegrityError'
  }
}

class ModelDownloadError extends Error {
  constructor(message, retryable) {
    super(message)
    this.code = 'ERR_SMOL_AI_MODEL_DOWNLOAD'
    this.name = 'ModelDownloadError'
    this.retryable = retryable
  }
}

const activeAcquisitions = new Map()

function abortError() {
  return new DOMException('GGUF model acquisition was aborted', 'AbortError')
}

async function acquireModel(manifest, options) {
  validateModelManifest(manifest)
  const opts = { __proto__: null, ...options }
  const finalPath = modelCachePath(opts.cacheRoot, manifest)
  const active = activeAcquisitions.get(finalPath)
  if (active) {
    return await active
  }
  const acquisition = acquireModelWithRetries(manifest, opts).finally(() => {
    activeAcquisitions.delete(finalPath)
  })
  activeAcquisitions.set(finalPath, acquisition)
  return await acquisition
}

async function acquireModelOnce(manifest, options) {
  const opts = { __proto__: null, ...options }
  const finalPath = modelCachePath(opts.cacheRoot, manifest)
  const partialPath = modelPartialPath(opts.cacheRoot, manifest)
  await mkdir(path.dirname(finalPath), { recursive: true })

  if (existsSync(finalPath)) {
    const finalStat = await stat(finalPath)
    if (
      finalStat.size === manifest.byteSize &&
      (await fileSha256(finalPath)) === manifest.sha256
    ) {
      return finalPath
    }
    await deleteFile(finalPath)
  }

  let offset = 0
  if (existsSync(partialPath)) {
    offset = (await stat(partialPath)).size
    if (offset > manifest.byteSize) {
      await deleteFile(partialPath)
      offset = 0
    }
  }
  if (opts.signal?.aborted) {
    throw abortError()
  }

  const source = await (opts.openSource || openHttpsSource)({
    offset,
    signal: opts.signal,
    url: manifest.url,
  })
  if (source.totalBytes !== manifest.byteSize) {
    await deleteFile(partialPath)
    throw new ModelIntegrityError(
      `GGUF model size metadata is ${source.totalBytes}; expected ${manifest.byteSize}`,
    )
  }
  if (source.startOffset === 0 && offset > 0) {
    await deleteFile(partialPath)
    offset = 0
  }

  const output = createWriteStream(partialPath, { flags: offset ? 'a' : 'w' })
  let loaded = offset
  try {
    for await (const chunk of source.chunks) {
      if (opts.signal?.aborted) {
        throw abortError()
      }
      await writeChunk(output, chunk)
      loaded += chunk.byteLength
      opts.onProgress?.({ loaded, total: manifest.byteSize })
    }
    if (opts.signal?.aborted) {
      throw abortError()
    }
  } finally {
    await closeOutput(output)
  }

  const downloadedSize = (await stat(partialPath)).size
  const downloadedSha256 = await fileSha256(partialPath)
  if (
    downloadedSize !== manifest.byteSize ||
    downloadedSha256 !== manifest.sha256
  ) {
    await deleteFile(partialPath)
    throw new ModelIntegrityError(
      `GGUF model integrity mismatch: got ${downloadedSize} bytes and sha256:${downloadedSha256}; expected ${manifest.byteSize} bytes and sha256:${manifest.sha256}`,
    )
  }
  await rename(partialPath, finalPath)
  return finalPath
}

async function acquireModelWithRetries(manifest, options) {
  const opts = { __proto__: null, ...options }
  const maxRetries = opts.maxRetries ?? 2
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new RangeError('maxRetries must be an integer from 0 through 10')
  }
  const retryDelayMs = opts.retryDelayMs ?? 250
  if (
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 0 ||
    retryDelayMs > 30_000
  ) {
    throw new RangeError('retryDelayMs must be an integer from 0 through 30000')
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await acquireModelOnce(manifest, opts)
    } catch (error) {
      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error
      }
      await waitForRetry(retryDelayMs * 2 ** attempt, opts.signal)
    }
  }
}

async function closeOutput(output) {
  await new Promise((resolve, reject) => {
    const onError = error => {
      output.off('finish', onFinish)
      reject(error)
    }
    const onFinish = () => {
      output.off('error', onError)
      resolve()
    }
    output.once('error', onError)
    output.once('finish', onFinish)
    output.end()
  })
}

function defaultModelCacheRoot() {
  if (process.env.SMOL_AI_MODEL_CACHE) {
    return path.resolve(process.env.SMOL_AI_MODEL_CACHE)
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'node-smol', 'ai')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'node-smol', 'ai')
  }
  return path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
    'node-smol',
    'ai',
  )
}

async function deleteFile(filePath) {
  await rm(filePath, { force: true })
}

async function fileSha256(filePath) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

function isRetryable(error) {
  if (error instanceof ModelDownloadError) {
    return error.retryable
  }
  return [
    'ECONNABORTED',
    'ECONNRESET',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'EPIPE',
    'ETIMEDOUT',
  ].includes(error?.code)
}

async function modelAvailability(manifest, options) {
  const opts = { __proto__: null, ...options }
  const finalPath = modelCachePath(opts.cacheRoot, manifest)
  if (activeAcquisitions.has(finalPath)) {
    return 'downloading'
  }
  if (!existsSync(finalPath)) {
    return 'downloadable'
  }
  const modelStat = await stat(finalPath)
  if (
    modelStat.size === manifest.byteSize &&
    (await fileSha256(finalPath)) === manifest.sha256
  ) {
    return 'available'
  }
  return 'downloadable'
}

function modelPartialPath(cacheRoot, manifest) {
  return `${modelCachePath(cacheRoot, manifest)}.partial`
}

async function openHttpsSource(request, redirects = 0) {
  const opts = { __proto__: null, ...request }
  if (redirects > 5) {
    throw new Error('GGUF model download exceeded five HTTPS redirects')
  }
  return await new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(abortError())
      return
    }
    const headers =
      opts.offset > 0 ? { Range: `bytes=${opts.offset}-` } : undefined
    const clientRequest = https.get(opts.url, { headers }, response => {
      const status = response.statusCode ?? 0
      const location = response.headers.location
      if (status >= 300 && status < 400 && location) {
        response.resume()
        const nextUrl = new URL(location, opts.url)
        if (nextUrl.protocol !== 'https:') {
          reject(new Error('GGUF model redirect must preserve HTTPS'))
          return
        }
        openHttpsSource({ ...opts, url: nextUrl.href }, redirects + 1).then(
          resolve,
          reject,
        )
        return
      }
      if (opts.offset > 0 && status === 200) {
        resolve({
          chunks: response,
          startOffset: 0,
          totalBytes: Number(response.headers['content-length'] ?? 0),
        })
        return
      }
      const expectedStatus = opts.offset > 0 ? 206 : 200
      if (status !== expectedStatus) {
        response.resume()
        reject(
          new ModelDownloadError(
            `GGUF model download returned HTTP ${status}; expected ${expectedStatus}`,
            [408, 425, 429, 500, 502, 503, 504].includes(status),
          ),
        )
        return
      }
      const contentRange = response.headers['content-range']
      const rangeTotal =
        typeof contentRange === 'string'
          ? /\/(?<total>\d+)$/.exec(contentRange)?.groups?.total
          : undefined
      const contentLength = Number(response.headers['content-length'] ?? 0)
      resolve({
        chunks: response,
        startOffset: opts.offset,
        totalBytes: rangeTotal
          ? Number(rangeTotal)
          : opts.offset + contentLength,
      })
    })
    const onAbort = () => clientRequest.destroy(abortError())
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    clientRequest.once('error', reject)
    clientRequest.once('close', () => {
      opts.signal?.removeEventListener('abort', onAbort)
    })
  })
}

async function waitForRetry(delayMs, signal) {
  if (signal?.aborted) {
    throw abortError()
  }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timeout)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, 'drain')
  }
}

module.exports = Object.freeze({
  ModelDownloadError,
  ModelIntegrityError,
  acquireModel,
  defaultModelCacheRoot,
  modelAvailability,
  modelPartialPath,
  openHttpsSource,
})

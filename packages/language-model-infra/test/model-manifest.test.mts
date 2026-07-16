import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  DEFAULT_MODEL_MANIFEST,
  modelCachePath,
  TEST_MODEL_MANIFEST,
  validateModelManifest,
} = require('../../npm/@node-smol/ai/lib/model-manifest.js') as {
  DEFAULT_MODEL_MANIFEST: ModelManifest
  modelCachePath(cacheRoot: string, manifest: ModelManifest): string
  TEST_MODEL_MANIFEST: ModelManifest
  validateModelManifest(manifest: ModelManifest): void
}

interface ModelManifest {
  readonly byteSize: number
  readonly contextSize: number
  readonly fileName: string
  readonly license: string
  readonly revision: string
  readonly runtimeCompatibility: string
  readonly sha256: string
  readonly url: string
}

describe('GGUF model manifests', () => {
  it('pins immutable revisions, byte sizes, checksums, and compatibility ids', () => {
    expect(DEFAULT_MODEL_MANIFEST).toMatchObject({
      byteSize: 105_454_432,
      license: 'apache-2.0',
      revision: '09816acd5d99df7be770d85ea30822623dab342c',
      runtimeCompatibility: 'llama.cpp-b9940',
      sha256:
        '2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d',
    })
    expect(DEFAULT_MODEL_MANIFEST.url).toContain(
      '/resolve/09816acd5d99df7be770d85ea30822623dab342c/',
    )
    expect(DEFAULT_MODEL_MANIFEST.url).not.toContain('/resolve/main/')

    expect(TEST_MODEL_MANIFEST).toMatchObject({
      byteSize: 1_185_376,
      revision: '99dd1a73db5a37100bd4ae633f4cfce6560e1567',
      sha256:
        '047bf46455a544931cff6fef14d7910154c56afbc23ab1c5e56a72e69912c04b',
    })
  })

  it('uses a content-addressed cache path', () => {
    expect(modelCachePath('/cache', DEFAULT_MODEL_MANIFEST)).toBe(
      `/cache/sha256/${DEFAULT_MODEL_MANIFEST.sha256}/${DEFAULT_MODEL_MANIFEST.fileName}`,
    )
  })

  it('rejects mutable URLs and malformed integrity metadata', () => {
    expect(() =>
      validateModelManifest({
        ...DEFAULT_MODEL_MANIFEST,
        url: DEFAULT_MODEL_MANIFEST.url.replace(
          DEFAULT_MODEL_MANIFEST.revision,
          'main',
        ),
      }),
    ).toThrow(/immutable revision/i)
    expect(() =>
      validateModelManifest({
        ...DEFAULT_MODEL_MANIFEST,
        sha256: 'not-a-checksum',
      }),
    ).toThrow(/sha-256/i)
  })
})

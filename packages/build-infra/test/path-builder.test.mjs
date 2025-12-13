/**
 * @fileoverview Tests for path-builder utilities.
 * Validates path resolution and builder pattern functionality.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createPathBuilder } from '../lib/path-builder.mjs'

/**
 * Get the platform-appropriate root directory for test paths.
 * Returns '/' on Unix/Mac, 'C:\' on Windows.
 * @returns {string} Platform root
 */
function getPlatformRoot() {
  return path.parse(process.cwd()).root
}

/**
 * Create a platform-appropriate file URL for testing.
 * @param {string} absolutePath - Absolute path (Unix or Windows format)
 * @returns {string} file:// URL
 */
function toFileURL(absolutePath) {
  return pathToFileURL(absolutePath).href
}

describe('path-builder', () => {
  describe('createPathBuilder', () => {
    it('should create path builder from import.meta.url', () => {
      // Create platform-appropriate test path
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const expectedPackageRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(paths.packageRoot).toBe(expectedPackageRoot)
      expect(paths.buildRoot).toBe(path.join(expectedPackageRoot, 'build'))
      expect(paths.distRoot).toBe(path.join(expectedPackageRoot, 'dist'))
      expect(paths.srcRoot).toBe(path.join(expectedPackageRoot, 'src'))
      expect(paths.__dirname).toBe(path.join(expectedPackageRoot, 'scripts'))
      expect(paths.__filename).toBe(scriptPath)
    })

    it('should handle custom scriptsRelative option', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'tools',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl, { scriptsRelative: '../..' })

      const expectedPackageRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(paths.packageRoot).toBe(expectedPackageRoot)
      expect(paths.buildRoot).toBe(path.join(expectedPackageRoot, 'build'))
    })

    it('should handle Windows-style paths', () => {
      // Use current platform's root for cross-platform testing
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      // Verify structure rather than exact format
      expect(paths.packageRoot).toContain('package')
      expect(paths.buildRoot).toContain('build')
      expect(paths.buildRoot).toBe(path.join(paths.packageRoot, 'build'))
    })
  })

  describe('buildPaths', () => {
    it('should create build paths for dev mode', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const buildPaths = paths.buildPaths('dev')

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(buildPaths.buildDir).toBe(path.join(expectedRoot, 'build', 'dev'))
      expect(buildPaths.sourceDir).toBe(
        path.join(expectedRoot, 'build', 'dev', 'source'),
      )
      expect(buildPaths.checkpointsDir).toBe(
        path.join(expectedRoot, 'build', 'dev', 'checkpoints'),
      )
    })

    it('should create build paths for prod mode', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const buildPaths = paths.buildPaths('prod')

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(buildPaths.buildDir).toBe(path.join(expectedRoot, 'build', 'prod'))
      expect(buildPaths.sourceDir).toBe(
        path.join(expectedRoot, 'build', 'prod', 'source'),
      )
      expect(buildPaths.checkpointsDir).toBe(
        path.join(expectedRoot, 'build', 'prod', 'checkpoints'),
      )
    })

    it('should handle custom subdirectories', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const buildPaths = paths.buildPaths('dev', {
        subdirs: ['wasm', 'models', 'artifacts'],
      })

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(buildPaths.wasmDir).toBe(
        path.join(expectedRoot, 'build', 'dev', 'wasm'),
      )
      expect(buildPaths.modelsDir).toBe(
        path.join(expectedRoot, 'build', 'dev', 'models'),
      )
      expect(buildPaths.artifactsDir).toBe(
        path.join(expectedRoot, 'build', 'dev', 'artifacts'),
      )
    })

    it('should preserve standard dirs when adding custom subdirs', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const buildPaths = paths.buildPaths('dev', { subdirs: ['custom'] })

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(buildPaths.buildDir).toBe(path.join(expectedRoot, 'build', 'dev'))
      expect(buildPaths.sourceDir).toBe(
        path.join(expectedRoot, 'build', 'dev', 'source'),
      )
      expect(buildPaths.customDir).toBe(
        path.join(expectedRoot, 'build', 'dev', 'custom'),
      )
    })
  })

  describe('sharedBuildPaths', () => {
    it('should create shared build paths', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const sharedPaths = paths.sharedBuildPaths()

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(sharedPaths.buildDir).toBe(
        path.join(expectedRoot, 'build', 'shared'),
      )
      expect(sharedPaths.sourceDir).toBe(
        path.join(expectedRoot, 'build', 'shared', 'source'),
      )
      expect(sharedPaths.checkpointsDir).toBe(
        path.join(expectedRoot, 'build', 'shared', 'checkpoints'),
      )
    })

    it('should handle custom subdirectories in shared paths', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const sharedPaths = paths.sharedBuildPaths({
        subdirs: ['cache', 'downloads'],
      })

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(sharedPaths.cacheDir).toBe(
        path.join(expectedRoot, 'build', 'shared', 'cache'),
      )
      expect(sharedPaths.downloadsDir).toBe(
        path.join(expectedRoot, 'build', 'shared', 'downloads'),
      )
    })
  })

  describe('wasmOutputPaths', () => {
    it('should create WASM output paths for ONNX Runtime', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const wasmPaths = paths.wasmOutputPaths('prod', 'ort')

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(wasmPaths.wasmDir).toBe(
        path.join(expectedRoot, 'build', 'prod', 'wasm'),
      )
      expect(wasmPaths.outputWasmFile).toBe(
        path.join(expectedRoot, 'build', 'prod', 'wasm', 'ort.wasm'),
      )
      expect(wasmPaths.outputMjsFile).toBe(
        path.join(expectedRoot, 'build', 'prod', 'wasm', 'ort.mjs'),
      )
      expect(wasmPaths.outputSyncJsFile).toBe(
        path.join(expectedRoot, 'build', 'prod', 'wasm', 'ort-sync.js'),
      )
    })

    it('should create WASM output paths for Yoga Layout', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const wasmPaths = paths.wasmOutputPaths('dev', 'yoga')

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(wasmPaths.outputWasmFile).toBe(
        path.join(expectedRoot, 'build', 'dev', 'wasm', 'yoga.wasm'),
      )
      expect(wasmPaths.outputMjsFile).toBe(
        path.join(expectedRoot, 'build', 'dev', 'wasm', 'yoga.mjs'),
      )
      expect(wasmPaths.outputSyncJsFile).toBe(
        path.join(expectedRoot, 'build', 'dev', 'wasm', 'yoga-sync.js'),
      )
    })
  })

  describe('modelPaths', () => {
    it('should create model paths for dev mode', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const modelPaths = paths.modelPaths('dev')

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(modelPaths.buildDir).toBe(path.join(expectedRoot, 'build', 'dev'))
      expect(modelPaths.modelsDir).toBe(
        path.join(expectedRoot, 'build', 'dev', 'models'),
      )
      expect(modelPaths.distDir).toBe(path.join(expectedRoot, 'dist', 'dev'))
    })

    it('should create model paths for prod mode', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const modelPaths = paths.modelPaths('prod')

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(modelPaths.buildDir).toBe(path.join(expectedRoot, 'build', 'prod'))
      expect(modelPaths.modelsDir).toBe(
        path.join(expectedRoot, 'build', 'prod', 'models'),
      )
      expect(modelPaths.distDir).toBe(path.join(expectedRoot, 'dist', 'prod'))
    })
  })

  describe('distPaths', () => {
    it('should create distribution paths', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)
      const distPaths = paths.distPaths('prod')

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(distPaths.distRoot).toBe(path.join(expectedRoot, 'dist'))
      expect(distPaths.distDir).toBe(path.join(expectedRoot, 'dist', 'prod'))
    })
  })

  describe('join helpers', () => {
    it('should join paths relative to package root', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(paths.join('lib', 'utils.mjs')).toBe(
        path.join(expectedRoot, 'lib', 'utils.mjs'),
      )
      expect(paths.join('test', 'fixtures', 'data.json')).toBe(
        path.join(expectedRoot, 'test', 'fixtures', 'data.json'),
      )
    })

    it('should join paths relative to build root', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(paths.joinBuild('dev', 'output.wasm')).toBe(
        path.join(expectedRoot, 'build', 'dev', 'output.wasm'),
      )
      expect(paths.joinBuild('shared', 'cache', 'artifact.tar.gz')).toBe(
        path.join(expectedRoot, 'build', 'shared', 'cache', 'artifact.tar.gz'),
      )
    })

    it('should join paths relative to source root', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(paths.joinSrc('index.ts')).toBe(
        path.join(expectedRoot, 'src', 'index.ts'),
      )
      expect(paths.joinSrc('components', 'Button.tsx')).toBe(
        path.join(expectedRoot, 'src', 'components', 'Button.tsx'),
      )
    })

    it('should handle empty path segments', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(paths.join()).toBe(expectedRoot)
      expect(paths.joinBuild()).toBe(path.join(expectedRoot, 'build'))
      expect(paths.joinSrc()).toBe(path.join(expectedRoot, 'src'))
    })

    it('should normalize path separators', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const result = paths.join('lib/utils/format.mjs')
      expect(result).toContain('lib')
      expect(result).toContain('utils')
      expect(result).toContain('format.mjs')
    })
  })

  describe('integration scenarios', () => {
    it('should support typical ONNX Runtime build workflow', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'onnxruntime-builder',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const prodPaths = paths.buildPaths('prod', {
        subdirs: ['out'],
      })
      const wasmPaths = paths.wasmOutputPaths('prod', 'ort')

      expect(prodPaths.buildDir).toContain('onnxruntime-builder')
      expect(prodPaths.buildDir).toContain('build')
      expect(prodPaths.buildDir).toContain('prod')
      expect(prodPaths.sourceDir).toContain('onnxruntime-builder')
      expect(prodPaths.sourceDir).toContain('source')
      expect(wasmPaths.outputWasmFile).toContain('onnxruntime-builder')
      expect(wasmPaths.outputWasmFile).toContain('wasm')
      expect(wasmPaths.outputWasmFile).toContain('ort.wasm')
    })

    it('should support typical model builder workflow', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'minilm-builder',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const prodPaths = paths.modelPaths('prod')
      const distPaths = paths.distPaths('prod')

      expect(prodPaths.modelsDir).toContain('minilm-builder')
      expect(prodPaths.modelsDir).toContain('models')
      expect(distPaths.distDir).toContain('minilm-builder')
      expect(distPaths.distDir).toContain('dist')
    })

    it('should support shared artifact caching', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const sharedPaths = paths.sharedBuildPaths({
        subdirs: ['downloads', 'cache'],
      })

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(sharedPaths.downloadsDir).toBe(
        path.join(expectedRoot, 'build', 'shared', 'downloads'),
      )
      expect(sharedPaths.cacheDir).toBe(
        path.join(expectedRoot, 'build', 'shared', 'cache'),
      )
    })
  })

  describe('edge cases', () => {
    it('should handle deeply nested script paths', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
        'tools',
        'scripts',
        'internal',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl, { scriptsRelative: '../../..' })

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        'package',
      )
      expect(paths.packageRoot).toBe(expectedRoot)
      expect(paths.buildRoot).toBe(path.join(expectedRoot, 'build'))
    })

    it('should handle package at filesystem root', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const expectedRoot = path.join(getPlatformRoot(), 'package')
      expect(paths.packageRoot).toBe(expectedRoot)
      expect(paths.buildRoot).toBe(path.join(expectedRoot, 'build'))
    })

    it('should handle special characters in package names', () => {
      const scriptPath = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        '@socketsecurity',
        'package',
        'scripts',
        'build.mjs',
      )
      const fakeUrl = toFileURL(scriptPath)
      const paths = createPathBuilder(fakeUrl)

      const expectedRoot = path.join(
        getPlatformRoot(),
        'Users',
        'test',
        '@socketsecurity',
        'package',
      )
      expect(paths.packageRoot).toBe(expectedRoot)
      expect(paths.buildRoot).toBe(path.join(expectedRoot, 'build'))
    })
  })
})

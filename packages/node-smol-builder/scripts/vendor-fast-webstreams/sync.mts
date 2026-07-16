#!/usr/bin/env node
/**
 * Sync fast-webstreams vendor from node_modules.
 *
 * Extracts experimental-fast-webstreams from node_modules, converts ES modules
 * to CommonJS, and places in the vendor directory for use in Node.js
 * additions.
 *
 * The package is managed as a devDependency for taze updates and grace period
 * tracking.
 *
 * Usage: node scripts/vendor-fast-webstreams/sync.mjs.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as acornParse } from 'acorn'
import { simple as acornWalkSimple } from 'acorn-walk'

import type { FunctionDeclaration } from 'acorn'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { readPackageJson } from '@socketsecurity/lib-stable/packages/read'
import process from 'node:process'
import { errorMessage } from 'build-infra/lib/error-utils'

import type { EditablePackageJson } from '@socketsecurity/lib-stable/packages/types'

import { convertToCommonJS, toInternalPath } from './sync-commonjs.mts'
import { addPrimordialsProtection } from './sync-primordials.mts'

export { convertToCommonJS, toInternalPath } from './sync-commonjs.mts'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PACKAGE_NAME = 'experimental-fast-webstreams'
const PACKAGE_ROOT = path.resolve(__dirname, '../..')
const NODE_MODULES_PKG = path.join(PACKAGE_ROOT, 'node_modules', PACKAGE_NAME)
const VENDOR_DIR = path.resolve(
  __dirname,
  '../../additions/source-patched/deps/fast-webstreams',
)

/**
 * Fix circular dependency in patch.js
 * patch.js imports from index.js, but index.js re-exports from patch.js
 * Fix by making patch.js import directly from the source modules.
 */
export function fixPatchCircularDependency(content: string, filename: string) {
  if (filename !== 'patch.js') {
    return content
  }

  // Replace: const { FastReadableStream, FastTransformStream, FastWritableStream } = require('internal/deps/fast-webstreams/index');
  // With direct requires to avoid circular dependency
  // Note: must use absolute internal paths since Node.js internal module system doesn't resolve relative paths
  return content.replace(
    /const\s*\{\s*FastReadableStream,\s*FastTransformStream,\s*FastWritableStream\s*\}\s*=\s*require\(['"]internal\/deps\/fast-webstreams\/index['"]\)/,
    `const { FastReadableStream } = require('internal/deps/fast-webstreams/readable')
const { FastTransformStream } = require('internal/deps/fast-webstreams/transform')
const { FastWritableStream } = require('internal/deps/fast-webstreams/writable')`,
  )
}

/**
 * Fix circular dependency between writer.js and writable.js.
 *
 * Problem: writable.js imports from writer.js, and writer.js imports from
 * writable.js. In CommonJS, when writable.js requires writer.js, writer.js
 * tries to destructure from writable.js's exports - but writable.js hasn't
 * finished executing yet.
 *
 * Solution: In writer.js, don't destructure at the top. Instead:
 *
 * 1. Get the module reference: const _writable = require('writable');
 * 2. Access exports at runtime when functions are called (not at module load)
 *
 * This works because the functions that use _writable exports are called after
 * both modules have finished loading (at runtime, not at module load time).
 */
export function fixWriterWritableCycle(content: string, filename: string) {
  if (filename !== 'writer.js') {
    return content
  }

  // Change destructuring import to module reference
  content = content.replace(
    /const\s*\{\s*_abortInternal,\s*_closeFromWriter,\s*_getDesiredSize,\s*_writeInternal\s*\}\s*=\s*require\(['"]internal\/deps\/fast-webstreams\/writable['"]\)/,
    `const _writable = require('internal/deps/fast-webstreams/writable')`,
  )

  // Replace direct calls with module access
  // _getDesiredSize(... → _writable._getDesiredSize(...
  content = content.replace(
    /\b_getDesiredSize\(/g,
    '_writable._getDesiredSize(',
  )
  content = content.replace(/\b_abortInternal\(/g, '_writable._abortInternal(')
  content = content.replace(
    /\b_closeFromWriter\(/g,
    '_writable._closeFromWriter(',
  )
  content = content.replace(/\b_writeInternal\(/g, '_writable._writeInternal(')

  return content
}

/**
 * Process and convert source files from node_modules.
 */
export async function processSourceFiles() {
  const srcDir = path.join(NODE_MODULES_PKG, 'src')
  if (!existsSync(srcDir)) {
    throw new Error(`Source directory not found: ${srcDir}`)
  }

  // Clean vendor directory
  safeDeleteSync(VENDOR_DIR)
  mkdirSync(VENDOR_DIR, { recursive: true })

  // Process each source file
  const files = readdirSync(srcDir).filter(f => f.endsWith('.js'))
  logger.info(`Processing ${files.length} source files…`)

  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]
    if (file === undefined) {
      continue
    }
    const srcPath = path.join(srcDir, file)
    const content = readFileSync(srcPath, 'utf8')
    let converted = convertToCommonJS(content, file)
    // Fix circular dependencies
    converted = fixPatchCircularDependency(converted, file)
    converted = fixWriterWritableCycle(converted, file)
    // Wire C++ chunk pool for zero-allocation reads (AST-based, reader.js only)
    converted = wireNativeChunkPool(converted, file)
    // Add primordials for security (must be last to catch all Promise patterns)
    converted = addPrimordialsProtection(converted, file)
    const destPath = path.join(VENDOR_DIR, file)
    writeFileSync(destPath, converted)
    logger.info(`  Converted: ${file}`)
  }

  // Create version file
  const versionFile = path.join(VENDOR_DIR, 'VERSION')
  const pkgJsonPath = path.join(NODE_MODULES_PKG, 'package.json')
  let pkgJson
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch (e) {
    throw new Error(
      `Failed to parse package.json at ${pkgJsonPath}: ${errorMessage(e)}`,
      { cause: e },
    )
  }
  // No sync timestamp: VERSION is inside the patch-chain content hash, and a
  // per-run timestamp invalidates the source-patched checkpoint on EVERY
  // build — an interrupted compile could never resume (it re-extracted
  // pristine source each invocation).
  writeFileSync(
    versionFile,
    `Package: ${PACKAGE_NAME}\nVersion: ${pkgJson.version}\n`,
  )

  // Copy package.json but remove the type field
  // Node.js internal module system (js2c) doesn't use package.json type resolution
  const vendorPkgPath = path.join(VENDOR_DIR, 'package.json')
  // readPackageJson({ editable: true }) returns an EditablePackageJson at
  // runtime; its declared return type does not model the editable variant.
  const editablePkgJson = (await readPackageJson(pkgJsonPath, {
    editable: true,
  })) as unknown as EditablePackageJson | undefined
  if (editablePkgJson === undefined) {
    throw new Error(`Failed to read package.json at ${pkgJsonPath}`)
  }
  editablePkgJson.update({ type: undefined })
  writeFileSync(
    vendorPkgPath,
    `${JSON.stringify(editablePkgJson.content, null, 2)}\n`,
  )

  return files.length
}

/**
 * Wire C++ chunk pool into reader.js using AST-based surgical replacement.
 *
 * Uses acorn to find the `_resolveReadResult` function by name and replaces
 * its body to use pre-allocated C++ chunk objects instead of allocating
 * `{ value, done: false }` per read. This is the single hot allocation point
 * for all WebStreams read operations.
 *
 * Also prepends the internalBinding import for the chunk pool.
 */
export function wireNativeChunkPool(content: string, filename: string) {
  if (filename !== 'reader.js') {
    return content
  }

  let ast
  try {
    ast = acornParse(content, {
      ecmaVersion: 2022,
      sourceType: 'script',
    })
  } catch {
    // If parsing fails (primordials not recognized), skip transform
    logger.warn(
      '  Skipping chunk pool wiring: acorn parse failed for reader.js',
    )
    return content
  }

  // Find _resolveReadResult function declaration by name
  let targetNode: FunctionDeclaration | undefined
  acornWalkSimple(ast, {
    FunctionDeclaration(node) {
      if (node.id && node.id.name === '_resolveReadResult') {
        targetNode = node
      }
    },
  })

  if (!targetNode) {
    logger.warn(
      '  Skipping chunk pool wiring: _resolveReadResult not found in reader.js',
    )
    return content
  }

  // Replace the function body using character offsets (surgical, no regex)
  const replacement = `function _resolveReadResult(value, done) {
  if (done) return DONE_PROMISE;
  _initPool();
  const chunk = _poolAcquire();
  _poolSetValue(chunk, value, false);
  return PromiseResolve(chunk);
}`

  content =
    content.slice(0, targetNode.start) +
    replacement +
    content.slice(targetNode.end)

  // Prepend lazy chunk pool binding after 'use strict'.
  // MUST be lazy (not top-level internalBinding) because reader.js is loaded
  // during V8 snapshot generation where the binding may not be fully initialized.
  const poolImport = [
    '',
    '// C++ chunk pool — lazy-initialized to avoid issues during V8 snapshot build.',
    'let _poolAcquire, _poolSetValue',
    'function _initPool() {',
    "  const b = internalBinding('smol_webstreams')",
    '  _poolAcquire = b.acquireChunk',
    '  _poolSetValue = b.setChunkValue',
    '  _initPool = () => {} // no-op after first call',
    '}',
    '',
  ].join('\n')

  // indexOf returns -1 if 'use strict' isn't found (e.g. converted-to-CJS
  // upstream uses double quotes); guard so we don't silently inject at the
  // very start of the file (which would land above any banner comment).
  const useStrictIdx = content.indexOf("'use strict'")
  if (useStrictIdx === -1) {
    throw new Error(
      "reader.js: expected leading 'use strict' to anchor lazy-pool inject point",
    )
  }
  const useStrictEnd = content.indexOf('\n', useStrictIdx)
  if (useStrictEnd !== -1) {
    content =
      content.slice(0, useStrictEnd + 1) +
      poolImport +
      content.slice(useStrictEnd + 1)
  }

  return content
}

/**
 * Main.
 */
async function main() {
  try {
    logger.info('=== fast-webstreams Vendor Sync ===')
    logger.error('')

    // Check node_modules package exists
    if (!existsSync(NODE_MODULES_PKG)) {
      throw new Error(
        `Package not found in node_modules: ${NODE_MODULES_PKG}\n` +
          'Run "pnpm install" first to install dependencies.',
      )
    }

    // Get version from node_modules
    const mainPkgJsonPath = path.join(NODE_MODULES_PKG, 'package.json')
    let pkgJson
    try {
      pkgJson = JSON.parse(readFileSync(mainPkgJsonPath, 'utf8'))
    } catch (e) {
      throw new Error(
        `Failed to parse package.json at ${mainPkgJsonPath}: ${errorMessage(e)}`,
        { cause: e },
      )
    }
    logger.info(`Source: node_modules/${PACKAGE_NAME}`)
    logger.info(`Version: ${pkgJson.version}`)

    // Process and convert files
    const fileCount = await processSourceFiles()

    logger.error('')
    logger.info('=== Sync Complete ===')
    logger.info(`Version: ${pkgJson.version}`)
    logger.info(`Files: ${fileCount}`)
    logger.info(`Output: ${VENDOR_DIR}`)
  } catch (e) {
    logger.fail('Sync failed:', errorMessage(e))
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})

/**
 * Generate synchronous WASM wrapper with embedded base64 binary.
 *
 * This utility eliminates duplicate WASM sync wrapper generation logic
 * across builder packages (onnxruntime-builder, yoga-layout-builder).
 *
 * It handles:
 * - Reading WASM binary and converting to base64
 * - Transforming ES module glue code to remove exports/await
 * - Generating synchronous wrapper with embedded WASM
 * - Smoke testing the generated wrapper
 */

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import MagicString from 'magic-string'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

// Handle @babel/traverse CommonJS/ESM interop
const traverse = traverseModule.default

/**
 * Generate a synchronous WASM wrapper with embedded base64 binary.
 *
 * @param {object} options - Configuration options
 * @param {string} options.wasmFile - Path to input WASM file
 * @param {string} options.mjsFile - Path to input MJS glue code file
 * @param {string} options.outputSyncJs - Path to output sync.js file
 * @param {string} options.packageName - Package name (e.g., 'onnxruntime', 'yoga-layout')
 * @param {string} options.initFunctionName - Name of the Emscripten init function (e.g., 'ortWasmThreaded', 'Module')
 * @param {string} options.exportName - Name of the exported object (e.g., 'ort', 'yoga')
 * @param {string} [options.description] - Optional description for the file header
 * @param {object} [options.logger] - Optional logger (defaults to build-output logger)
 * @param {Function} [options.customSmokeTest] - Optional custom smoke test function for sync.js
 * @returns {Promise<void>}
 */
export async function generateWasmSyncWrapper(options) {
  const {
    customSmokeTest,
    description,
    exportName,
    initFunctionName,
    logger = getDefaultLogger(),
    mjsFile,
    outputSyncJs,
    packageName,
    wasmFile,
  } = options

  if (!existsSync(wasmFile)) {
    throw new Error(`WASM file not found: ${wasmFile}`)
  }

  if (!existsSync(mjsFile)) {
    throw new Error(`MJS glue code file not found: ${mjsFile}`)
  }

  logger.substep('Generating synchronous .js wrapper with embedded WASM...')

  // Read WASM binary and convert to base64
  const wasmBinary = await fs.readFile(wasmFile)
  const base64Wasm = wasmBinary.toString('base64')
  let mjsContent = await fs.readFile(mjsFile, 'utf-8')

  // Use @babel/parser + @babel/traverse + magic-string to properly transform the ES module
  // This is more robust than regex for handling ES module syntax
  const ast = parse(mjsContent, {
    plugins: [],
    sourceType: 'module',
  })

  const s = new MagicString(mjsContent)

  // Aggressively convert from ESM/async to CommonJS/sync
  // This handles:
  // 1. Remove all export statements (ESM → CommonJS)
  // 2. Remove all import statements (not needed in embedded context)
  // 3. Remove async keyword from all function declarations
  // 4. Remove ALL await expressions (top-level and nested)
  // 5. Remove top-level statements that fetch/load WASM asynchronously

  const topLevelStatementsToRemove = []

  traverse(ast, {
    // Remove ALL export statements (convert ESM to CommonJS)
    ExportDefaultDeclaration(path) {
      if (path.parent.type === 'Program') {
        s.remove(path.node.start, path.node.end)
      }
    },
    ExportNamedDeclaration(path) {
      if (path.parent.type === 'Program') {
        if (path.node.declaration) {
          // Remove "export" keyword only: "export const foo" → "const foo"
          s.remove(path.node.start, path.node.declaration.start)
        } else {
          // Remove entire statement: export { ... };
          s.remove(path.node.start, path.node.end)
        }
      }
    },
    // Remove ALL import statements (not needed with embedded WASM)
    ImportDeclaration(path) {
      if (path.parent.type === 'Program') {
        s.remove(path.node.start, path.node.end)
      }
    },
    // Remove async keyword from ALL function declarations
    FunctionDeclaration(path) {
      if (path.node.async) {
        // Remove "async " keyword
        const asyncKeywordPos = mjsContent.indexOf('async', path.node.start)
        if (asyncKeywordPos >= 0 && asyncKeywordPos < path.node.start + 20) {
          // "async " is 6 chars
          s.remove(asyncKeywordPos, asyncKeywordPos + 6)
        }
      }
    },
    FunctionExpression(path) {
      if (path.node.async) {
        const asyncKeywordPos = mjsContent.indexOf('async', path.node.start)
        if (asyncKeywordPos >= 0 && asyncKeywordPos < path.node.start + 20) {
          s.remove(asyncKeywordPos, asyncKeywordPos + 6)
        }
      }
    },
    ArrowFunctionExpression(path) {
      if (path.node.async) {
        const asyncKeywordPos = mjsContent.indexOf('async', path.node.start)
        if (asyncKeywordPos >= 0 && asyncKeywordPos < path.node.start + 20) {
          s.remove(asyncKeywordPos, asyncKeywordPos + 6)
        }
      }
    },
    // Remove ALL await expressions (convert async to sync)
    AwaitExpression(path) {
      // Check if this is top-level (mark entire statement for removal)
      let current = path
      let isTopLevel = false
      while (current.parent) {
        if (current.parent.type === 'Program') {
          isTopLevel = true
          break
        }
        if (
          current.parent.type === 'FunctionDeclaration' ||
          current.parent.type === 'FunctionExpression' ||
          current.parent.type === 'ArrowFunctionExpression' ||
          current.parent.type === 'ObjectMethod' ||
          current.parent.type === 'ClassMethod'
        ) {
          break
        }
        current = current.parentPath
      }

      if (isTopLevel) {
        // Top-level await: mark entire statement for removal
        let statement = path
        while (statement.parent && statement.parent.type !== 'Program') {
          statement = statement.parentPath
        }
        if (statement.node && statement.parent.type === 'Program') {
          topLevelStatementsToRemove.push(statement.node)
        }
      } else {
        // Nested await: just remove the "await " keyword
        const awaitKeywordPos = mjsContent.indexOf('await', path.node.start)
        if (awaitKeywordPos >= 0 && awaitKeywordPos < path.node.start + 10) {
          // "await " is 6 chars
          s.remove(awaitKeywordPos, awaitKeywordPos + 6)
        }
      }
    },
  })

  // Remove all top-level statements containing await
  for (const node of topLevelStatementsToRemove) {
    s.remove(node.start, node.end)
  }

  mjsContent = s.toString()

  // Get file size for documentation
  const mjsStats = await fs.stat(mjsFile)

  // Build description line
  const descLine = description
    ? ` * ${description}`
    : ' * Built for synchronous instantiation.'

  // Generate the synchronous wrapper
  const jsContent = `'use strict';

/**
 * Synchronous ${packageName} with embedded WASM binary.
 *
 * This file is AUTO-GENERATED by ${packageName}-builder.
${descLine}
 *
 * Source: ${path.basename(mjsFile)} (${mjsStats.size} bytes)
 * WASM: ${wasmBinary.length} bytes (${base64Wasm.length} bytes base64)
 */

// Base64-encoded WASM binary (embedded at build time).
const base64Wasm = '${base64Wasm}';

// Decode base64 to Uint8Array.
const wasmBinary = Uint8Array.from(atob(base64Wasm), c => c.charCodeAt(0));

// Inlined Emscripten loader from ${packageName} build.
${mjsContent}

// Synchronously initialize ${packageName} with embedded WASM.
const ${exportName} = ${initFunctionName}({
  wasmBinary,
  instantiateWasm(imports, successCallback) {
    // Synchronously instantiate WASM module.
    const module = new WebAssembly.Module(wasmBinary);
    const instance = new WebAssembly.Instance(module, imports);
    successCallback(instance, module);
    return instance.exports;
  }
});

// CommonJS export for Node.js compatibility.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ${exportName};
}
`

  await fs.writeFile(outputSyncJs, jsContent, 'utf-8')

  const syncJsSize = (await fs.stat(outputSyncJs)).size
  logger.substep(`Sync JS (sync + embedded): ${outputSyncJs}`)
  logger.substep(`Sync JS size: ${(syncJsSize / 1024).toFixed(2)} KB`)

  // Smoke test the sync.js file
  logger.substep(`Smoke testing ${path.basename(outputSyncJs)}...`)

  if (customSmokeTest) {
    // Use custom smoke test if provided
    await customSmokeTest(outputSyncJs, logger)
  } else {
    // Default smoke test: Just verify the file exists and is not empty
    if (!existsSync(outputSyncJs)) {
      throw new Error('Sync JS file not found after generation')
    }

    const syncStats = await fs.stat(outputSyncJs)
    if (syncStats.size === 0) {
      throw new Error('Sync JS file is empty')
    }

    logger.substep(
      `Sync JS file valid (${(syncStats.size / 1024).toFixed(2)} KB)`,
    )
  }

  logger.success('WASM sync wrapper generated')
}
